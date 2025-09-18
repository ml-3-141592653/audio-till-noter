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

app = FastAPI()

# CORS: lägg in din frontend-URL i allow_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # byt till din deployade domän senare
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TranscribeResponse(BaseModel):
    musicxml: str
    midi_b64: str
    meta: dict

def _bytes_to_wav_if_needed(data: bytes, mime: str) -> bytes:
    """Returnerar WAV PCM bytes oavsett om input var wav/webm/ogg."""
    if mime in ("audio/wav", "audio/x-wav"):
        return data
    # Försök dekoda med libsndfile via soundfile (fungerar för bl.a. ogg/opus)
    try:
        buf = io.BytesIO(data)
        audio, sr = sf.read(buf, dtype="float32", always_2d=False)
        out = io.BytesIO()
        sf.write(out, audio, sr, format="WAV", subtype="PCM_16")
        return out.getvalue()
    except Exception:
        # Fallback: ffmpeg om installerat (bra för webm/mp4 på Safari/Chrome)
        try:
            with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tmp_in, \
                 tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_out:
                tmp_in.write(data); tmp_in.flush()
                cmd = ["ffmpeg", "-y", "-i", tmp_in.name, "-ac", "1", "-ar", "44100", tmp_out.name]
                subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                with open(tmp_out.name, "rb") as f:
                    wav_bytes = f.read()
                return wav_bytes
        finally:
            for p in [locals().get("tmp_in"), locals().get("tmp_out")]:
                try:
                    if p: os.unlink(p.name)
                except Exception:
                    pass

@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(file: UploadFile = File(...)):
    if not file.content_type.startswith("audio/"):
        raise HTTPException(400, "Expected audio/* upload")

    raw = await file.read()
    wav_bytes = _bytes_to_wav_if_needed(raw, file.content_type)

    # Skriv WAV till tempfil
    with tempfile.TemporaryDirectory() as td:
        wav_path = os.path.join(td, "input.wav")
        with open(wav_path, "wb") as f:
            f.write(wav_bytes)

        # Kör Basic Pitch → skriver .mid i output-dir
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

        # Hitta den genererade MIDI-filen
        mid_path = None
        for name in os.listdir(out_dir):
            if name.lower().endswith(".mid") or name.lower().endswith(".midi"):
                mid_path = os.path.join(out_dir, name)
                break
        if not mid_path:
            raise HTTPException(500, "No MIDI produced")

        # Läs MIDI → MusicXML med music21
        s = converter.parse(mid_path)  # music21.converter.parse
        # Exportera till MusicXML som sträng
        musicxml_str = s.write("musicxml")  # returns path; få sträng:
        # read back as text
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
