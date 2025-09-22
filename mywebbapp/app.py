from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64, tempfile, os, subprocess
import soundfile as sf
import io

from basic_pitch.inference import predict_and_save
from basic_pitch import ICASSP_2022_MODEL_PATH
import pretty_midi
from music21 import converter

app = FastAPI(title="Audio to Notes API")

# Get allowed origins from environment variable or use default for local development
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")

# Configure CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TranscribeResponse(BaseModel):
    musicxml: str
    midi_b64: str
    meta: dict

def _get_ffmpeg_path():
    """Get the ffmpeg executable path."""
    # Check common installation locations
    possible_paths = [
        "ffmpeg",  # If in PATH
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\ffmpeg\bin\ffmpeg.exe",
    ]
    for path in possible_paths:
        try:
            subprocess.run([path, "-version"], capture_output=True)
            return path
        except Exception:
            continue
    return None

def _bytes_to_wav_if_needed(data: bytes, mime: str) -> bytes:
    """
    Converts audio data to WAV PCM format if not already in WAV format.
    Supports various input formats including webm, ogg, and mp4.
    
    Args:
        data: Raw audio bytes
        mime: MIME type of the input audio
        
    Returns:
        bytes: Audio data in WAV PCM format
    """
    print(f"Converting audio from {mime} to WAV")
    
    if mime in ("audio/wav", "audio/x-wav"):
        return data

    # For WebM (most common from browser recording), try ffmpeg first
    if mime in ("audio/webm", "audio/webm;codecs=opus"):
        ffmpeg_path = _get_ffmpeg_path()
        if not ffmpeg_path:
            raise RuntimeError("ffmpeg not found. Please install ffmpeg to handle WebM audio.")
            
        try:
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp_in, \
                 tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_out:
                tmp_in.write(data)
                tmp_in.flush()
                
                cmd = [ffmpeg_path, "-y", "-i", tmp_in.name, "-ac", "1", "-ar", "44100", tmp_out.name]
                result = subprocess.run(cmd, capture_output=True, text=True)
                
                if result.returncode != 0:
                    print(f"ffmpeg stderr: {result.stderr}")
                    raise RuntimeError(f"ffmpeg conversion failed: {result.stderr}")
                
                with open(tmp_out.name, "rb") as f:
                    wav_bytes = f.read()
                return wav_bytes
        except Exception as e:
            raise RuntimeError(f"Failed to convert WebM: {str(e)}")
            
    # For other formats, try soundfile first
    try:
        buf = io.BytesIO(data)
        audio, sr = sf.read(buf, dtype="float32", always_2d=False)
        out = io.BytesIO()
        sf.write(out, audio, sr, format="WAV", subtype="PCM_16")
        return out.getvalue()
    except Exception as e:
        print(f"soundfile conversion failed: {str(e)}")
        raise RuntimeError(f"Unsupported audio format {mime}")
    finally:
        for p in [locals().get("tmp_in"), locals().get("tmp_out")]:
            try:
                if p: os.unlink(p.name)
            except Exception:
                pass

@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(file: UploadFile = File(...)):
    """
    Transcribe audio to music notation.
    Supports WebM (from browser recording), WAV, OGG, and other audio formats.
    """
    try:
        if not file.content_type.startswith("audio/"):
            raise HTTPException(400, "Expected audio/* upload")
        print(f"Processing file of type: {file.content_type}")

        raw = await file.read()
        print(f"File read successfully ({len(raw)} bytes), converting to WAV...")
        
        try:
            wav_bytes = _bytes_to_wav_if_needed(raw, file.content_type)
            print(f"Conversion to WAV completed ({len(wav_bytes)} bytes)")
        except Exception as e:
            print(f"Audio conversion error: {str(e)}")
            if "ffmpeg not found" in str(e):
                raise HTTPException(500, "Server configuration error: ffmpeg is required but not installed. Please install ffmpeg.")
            raise HTTPException(500, f"Error converting audio: {str(e)}")
    except Exception as e:
        print(f"Error processing audio: {str(e)}")
        raise HTTPException(500, f"Error processing audio: {str(e)}")

    # Create temporary directory for audio processing
    with tempfile.TemporaryDirectory() as td:
        wav_path = os.path.join(td, "input.wav")
        with open(wav_path, "wb") as f:
            f.write(wav_bytes)

        # Run Basic Pitch ML model for audio-to-MIDI conversion
        out_dir = os.path.join(td, "out")
        os.makedirs(out_dir, exist_ok=True)
        predict_and_save(
            [wav_path],
            out_dir,
            save_midi=True,
            save_model_outputs=False,
            onset_threshold=0.5,
            frame_threshold=0.3,
            model_or_model_path=ICASSP_2022_MODEL_PATH,
        )

        # Locate the generated MIDI file
        mid_path = None
        for name in os.listdir(out_dir):
            if name.lower().endswith((".mid", ".midi")):
                mid_path = os.path.join(out_dir, name)
                break
        if not mid_path:
            raise HTTPException(500, "No MIDI file was generated")

        # Convert MIDI to MusicXML using music21
        s = converter.parse(mid_path)
        # Export to MusicXML and read as string
        musicxml_str = s.write("musicxml")  # Returns file path
        with open(musicxml_str, "r", encoding="utf-8") as f:
            xml_text = f.read()

        # MIDI → base64
        with open(mid_path, "rb") as f:
            midi_b64 = base64.b64encode(f.read()).decode("ascii")

        # Meta (duration)
        pm = pretty_midi.PrettyMIDI(mid_path)
        duration = pm.get_end_time()

    return TranscribeResponse(
        musicxml=xml_text,
        midi_b64=midi_b64,
        meta={"duration_sec": round(duration, 2)}
    )
