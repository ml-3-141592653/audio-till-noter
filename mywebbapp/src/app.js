const els = {
    btnRecord: document.getElementById("btnRecord"),
    btnStop: document.getElementById("btnStop"),
    btnTranscribe: document.getElementById("btnTranscribe"),
    btnNew: document.getElementById("btnNew"),
    timer: document.getElementById("timer"),
    preview: document.getElementById("preview"),
    status: document.getElementById("status"),
    score: document.getElementById("score"),
    progressSpinner: document.getElementById("progressSpinner"),
};

let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let recordingBlob = null;
let timerId = null;
const MAX_SEC = 15;
// Configure the API base URL. Change this when deploying to production
const API_BASE = window.API_BASE || "http://localhost:8000";

// UI Helper Functions
/**
 * Updates the status message display
 * @param {string | null} msg - Status message to display
 */
function setStatus(msg, isError = false) { 
    els.status.textContent = msg ?? ""; 
    els.status.className = isError ? "text-danger" : "text-muted";
}

/**
 * Updates button states based on recording and processing status
 * @param {Object} options
 * @param {boolean} options.recording - Whether recording is in progress
 * @param {boolean} options.hasAudio - Whether audio has been recorded
 * @param {boolean} options.processing - Whether audio is being processed
 */
function setButtons({ recording = false, hasAudio = false, processing = false } = {}) {
    els.btnRecord.disabled = recording || processing;
    els.btnStop.disabled = !recording || processing;
    els.btnTranscribe.disabled = !hasAudio || processing;
    els.btnNew.disabled = processing;
    els.progressSpinner.style.display = processing ? "inline-block" : "none";
}
function formatMMSS(s) {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
}
function startTimer(limitSec = MAX_SEC) {
    let t = 0;
    els.timer.textContent = formatMMSS(0);
    timerId = setInterval(() => {
        t++;
        els.timer.textContent = formatMMSS(t);
        if (t >= limitSec) stopRecording();
    }, 1000);
}
function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
}


async function startRecording() {
    try {
        // Request microphone access and initialize audio stream
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Define supported audio formats in order of preference
        const preferredTypes = [
            "audio/webm;codecs=opus",  // Best quality and compression
            "audio/webm",
            "audio/ogg;codecs=opus",
            "audio/ogg",
            "audio/mp4",
        ];
        let options = {};
        for (const mt of preferredTypes) {
            if (MediaRecorder.isTypeSupported?.(mt)) { options.mimeType = mt; break; }
        }
        mediaRecorder = new MediaRecorder(mediaStream, options);
        chunks = [];
        recordingBlob = null;

        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
            stopTimer();
            try {
                recordingBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
                els.preview.src = URL.createObjectURL(recordingBlob);
                setStatus(`Captured ${Math.round(recordingBlob.size / 1024)} KB (${mediaRecorder.mimeType || "audio/webm"})`);
                setButtons({ recording: false, hasAudio: true });
            } catch (err) {
                console.error(err);
                setStatus("Failed to build audio blob.");
                setButtons({ recording: false, hasAudio: false });
            } finally {
                // release mic
                mediaStream?.getTracks().forEach(t => t.stop());
                mediaStream = null;
            }
        };

        mediaRecorder.start(); //begin rec
        setButtons({ recording: true, hasAudio: false });
        setStatus("Recording…");
        startTimer(MAX_SEC);

    } catch (err) {
        console.error(err);
        setStatus("Mic permission failed or unsupported context. Tip: use HTTPS or localhost.");
        setButtons({ recording: false, hasAudio: false });
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
}

// Initialize the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Verify all required elements are present
    for (const [key, element] of Object.entries(els)) {
        if (!element) {
            console.error(`Missing required element: #${key}`);
            return;
        }
    }

    // Add event listeners
    els.btnRecord.addEventListener("click", startRecording);
    els.btnStop.addEventListener("click", stopRecording);
    els.btnNew.addEventListener("click", resetRecording);
    els.btnTranscribe.addEventListener("click", handleTranscription);

    // Set initial button states
    setButtons({ recording: false, hasAudio: false });
    console.info("Note: getUserMedia/MediaRecorder need a secure context (HTTPS or localhost).");
});

// Function to reset the recording state
function resetRecording() {
    recordingBlob = null;
    chunks = [];
    els.preview.src = "";
    els.score.innerHTML = "";
    const dlButtons = document.querySelector(".download-buttons");
    if (dlButtons) dlButtons.remove();
    setStatus("");
    setButtons({ recording: false, hasAudio: false });
}

// Handle audio transcription
async function handleTranscription() {
    if (!recordingBlob) return;
    setStatus("Uploading & transcribing audio...");
    setButtons({ processing: true });

    // Prepare audio data for upload
    // Note: FormData key must be 'file' to match FastAPI's UploadFile parameter
    const fd = new FormData();
    fd.append("file", recordingBlob, "take.webm");

    try {
        const resp = await fetch(`${API_BASE}/transcribe`, {
            method: "POST",
            body: fd,
        });
        if (!resp.ok) {
            const t = await resp.text();
            console.error('Server response:', t);
            throw new Error(`Server error: ${t || 'Unknown error'}`);
        }
        const data = await resp.json(); // { musicxml, midi_b64, meta }
        
        setStatus("Rendering score...");
        // Clear previous score
        els.score.innerHTML = "";

        // Render the score using OpenSheetMusicDisplay
        const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("score", {
            autoResize: true,
            drawTitle: true,
        });
        await osmd.load(data.musicxml);
        await osmd.render();

        // Create download links for MIDI and MusicXML files
        const midiBytes = Uint8Array.from(atob(data.midi_b64), c => c.charCodeAt(0));
        const midiBlob = new Blob([midiBytes], { type: "audio/midi" });
        const xmlBlob = new Blob([data.musicxml], { type: "application/vnd.recordare.musicxml+xml" });

        const dlWrap = document.createElement("div");
        dlWrap.className = "mt-3 d-flex gap-2 flex-wrap";

        const aMidi = document.createElement("a");
        aMidi.href = URL.createObjectURL(midiBlob);
        aMidi.download = "transcription.mid";
        aMidi.className = "btn btn-outline-primary btn-sm";
        aMidi.textContent = "Download MIDI";

        const aXml = document.createElement("a");
        aXml.href = URL.createObjectURL(xmlBlob);
        aXml.download = "transcription.musicxml";
        aXml.className = "btn btn-outline-secondary btn-sm";
        aXml.textContent = "Download MusicXML";

        dlWrap.appendChild(aMidi);
        dlWrap.appendChild(aXml);
        dlWrap.className = "download-buttons mt-3 d-flex gap-2 flex-wrap";
        els.score.parentElement.appendChild(dlWrap);

        const duration = data.meta?.duration_sec ?? "?";
        setStatus(`Transcription complete! Duration: ~${duration}s`);
    } catch (err) {
        console.error(err);
        const errorMsg = err.message.includes('Server error') ? 
            err.message : 
            'Transcription failed. Please try again or check if your recording contains clear notes.';
        setStatus(errorMsg, true);
    } finally {
        setButtons({ hasAudio: !!recordingBlob, processing: false });
    }
}


// Initial setup happens in the DOMContentLoaded event listener
