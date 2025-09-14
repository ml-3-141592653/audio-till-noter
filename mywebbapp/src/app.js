const els = {
    btnRecord: document.getElementById("btnRecord"),
    btnStop: document.getElementById("btnStop"),
    btnTranscribe: document.getElementById("btnTranscribe"),
    timer: document.getElementById("timer"),
    preview: document.getElementById("preview"),
    status: document.getElementById("status"),
    score: document.getElementById("score"),
}

let recordingBlob = null;

function setStatus(msg) {
    els.status.textContent = msg ?? "";
}

function setButtons({ recording = false, hasAudio = false } = {}) {
    els.btnRecord.disabled = recording;
    els.btnStop.disabled = !recording;
    els.btnTranscribe.disabled = !hasAudio;
}

els.btnRecord.addEventListener("click", () => {
    setStatus("Recording...");
    //later: real recording. TODO
});
els.btnStop.addEventListener("click", () => {
    setStatus("Stopped (stub).");
});
els.btnTranscribe.addEventListener("click", async () => {
    setStatus("Transcribing (stub)...");
    //Later: post- todo
});

setButtons({ recording: false, hasAudio: false });
