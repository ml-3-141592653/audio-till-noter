const els = {
    btnRecord: document.getElementById("btnRecord"),
    btnStop: document.getElementById("btnStop"),
    btnTranscribe: document.getElementById("btnTranscribe"),
    timer: document.getElementById("timer"),
    preview: document.getElementById("preview"),
    status: document.getElementById("status"),
    score: document.getElementById("score"),
};

let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let recordingBlob = null;
let timerId = null;
const MAX_SEC = 15;

//helpers
function setStatus(msg) { els.status.textContent = msg ?? ""; }
function setButtons({ recording = false, hasAudio = false } = {}) {
    els.btnRecord.disabled = recording;
    els.btnStop.disabled = !recording;
    els.btnTranscribe.disabled = !hasAudio;
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
        //>ask for mic:
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const preferredTypes = [
            "audio/webm;codecs=opus",
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

els.btnRecord.addEventListener("click", startRecording);
els.btnStop.addEventListener("click", stopRecording);

// TODO upload to backend
els.btnTranscribe.addEventListener("click", async () => {
    if (!recordingBlob) return;
    setStatus("Uploading & transcribing…");

    // 1) Packa blob i FormData (nyckeln MÅSTE heta 'file' för FastAPI UploadFile)
    const fd = new FormData();
    // välj valfritt filnamn; backend tittar främst på fältet 'file'
    fd.append("file", recordingBlob, "take.webm");

    try {
        const resp = await fetch("http://localhost:8000/transcribe", {
            method: "POST",
            body: fd, // fetch sätter rätt multipart boundary automatiskt
        });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${t}`);
        }
        const data = await resp.json(); // { musicxml, midi_b64, meta }

        // 2) Rendera MusicXML med OpenSheetMusicDisplay
        const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("score", {
            autoResize: true,
            drawTitle: true,
        });
        await osmd.load(data.musicxml);
        await osmd.render();

        // 3) Skapa nedladdningslänkar för MIDI och MusicXML
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
        els.score.parentElement.appendChild(dlWrap);

        setStatus(`Done. Duration ~${data.meta?.duration_sec ?? "?"}s`);
    } catch (err) {
        console.error(err);
        setStatus("Transcription failed. Check console & backend logs.");
    }
});


setButtons({ recording: false, hasAudio: false });
console.info("Note: getUserMedia/MediaRecorder need a secure context (HTTPS or localhost).");
