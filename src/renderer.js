const $ = id => document.getElementById(id);
const api = window.obsLite;
const isMac = api.platform === "darwin";
const PRESETS = {
  smooth: { resolution: "1920x1080", fps: "60", bitrate: "20000000" },
  crispy: { resolution: "2560x1440", fps: "60", bitrate: "35000000" },
  ultra:  { resolution: "3840x2160", fps: "60", bitrate: "50000000" }
};
const FIELDS = ["resolution", "fps", "bitrate", "audio", "countdown", "hideOnStart"];
const MIMES = [
  "video/mp4;codecs=avc1.640034,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1,opus", "video/mp4",
  "video/webm;codecs=h264,opus", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"
];

let selectedSource = null, stream = null, micStream = null, audioCtx = null, recorder = null;
let startedAt = 0, elapsedBeforePause = 0, timerHandle = null, isPaused = false;
let writeChain = Promise.resolve(), bytesWritten = 0, lastFile = null, busy = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mb = n => (n / 1048576).toFixed(n > 1e9 ? 2 : 1) + " MB";

function setStatus(text, live = false) {
  $("statusText").textContent = text;
  $("statusDot").classList.toggle("live", live);
  $("recordState").textContent = text;
}
function formatTime(ms) {
  const t = Math.floor(ms / 1000), p = n => String(n).padStart(2, "0");
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}

/* ---------- settings ---------- */
function saveSettings() {
  const s = {};
  FIELDS.forEach(k => { const el = $(k); s[k] = el.type === "checkbox" ? el.checked : el.value; });
  try { localStorage.setItem("obslite", JSON.stringify(s)); } catch {}
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("obslite") || "{}");
    FIELDS.forEach(k => {
      if (!(k in s)) return;
      const el = $(k);
      if (el.type === "checkbox") el.checked = !!s[k];
      else if ([...el.options].some(o => o.value === String(s[k]))) el.value = s[k];
    });
  } catch {}
}
function markPreset() {
  document.querySelectorAll("[data-preset]").forEach(b => {
    const p = PRESETS[b.dataset.preset];
    b.classList.toggle("active", Object.keys(p).every(k => $(k).value === p[k]));
  });
}
document.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => {
  Object.entries(PRESETS[b.dataset.preset]).forEach(([k, v]) => { $(k).value = v; });
  markPreset(); saveSettings();
}));
FIELDS.forEach(k => $(k).addEventListener("change", () => { markPreset(); saveSettings(); }));

if (isMac) {
  ["system", "both"].forEach(v => $("audio").querySelector(`option[value="${v}"]`)?.remove());
  $("audio").value = "mic";
  $("audioHint").textContent = "System audio isn't available on macOS - the microphone is used instead.";
}
loadSettings();
markPreset();

/* ---------- sources ---------- */
async function loadSources() {
  $("sources").innerHTML = '<div class="empty">Loading available screens and windows…</div>';
  try {
    const perm = await api.screenPermission();
    $("permHint").hidden = perm === "granted";
    const sources = await api.listSources();
    $("sourceCount").textContent = `${sources.length} available`;
    if (!sources.length) {
      $("sources").innerHTML = '<div class="empty">No capture sources found. Allow screen recording for OBS Lite in system settings, then restart the app.</div>';
      return;
    }
    $("sources").innerHTML = "";
    sources.forEach((source, i) => {
      const b = document.createElement("button");
      b.className = "source-card" + (selectedSource?.id === source.id ? " selected" : "");
      b.innerHTML = `<img alt=""><span class="source-name"></span>`;
      b.querySelector("img").src = source.thumbnail;
      b.querySelector(".source-name").textContent = source.name || `Source ${i + 1}`;
      b.addEventListener("click", () => {
        selectedSource = source;
        document.querySelectorAll(".source-card").forEach(el => el.classList.remove("selected"));
        b.classList.add("selected");
        $("startBtn").disabled = !!recorder;
      });
      $("sources").appendChild(b);
    });
    if (!selectedSource || !sources.some(s => s.id === selectedSource.id)) {
      selectedSource = sources[0];
      $("sources").children[0].classList.add("selected");
    }
    $("startBtn").disabled = !!recorder;
  } catch (e) {
    $("sources").innerHTML = `<div class="empty">Could not list capture sources: ${e.message}</div>`;
  }
}

/* ---------- recording ---------- */
function dims() {
  const v = $("resolution").value;
  if (v === "source") return {};
  const [width, height] = v.split("x").map(Number);
  return { width, height };
}

async function buildStream() {
  const fps = Number($("fps").value), d = dims(), mode = $("audio").value;
  const needSys = !isMac && (mode === "system" || mode === "both");
  const needMic = mode === "mic" || mode === "both";
  const video = { mandatory: {
    chromeMediaSource: "desktop", chromeMediaSourceId: selectedSource.id,
    minFrameRate: fps, maxFrameRate: fps,
    ...(d.width ? { maxWidth: d.width, maxHeight: d.height } : {})
  } };
  const sysAudio = { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: selectedSource.id } };
  stream = await navigator.mediaDevices.getUserMedia({ audio: needSys ? sysAudio : false, video });
  const vt = stream.getVideoTracks()[0];
  if (vt && "contentHint" in vt) vt.contentHint = "motion"; // favour smooth motion for games
  if (needMic) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false }, video: false
    });
  }
  const tracks = [...stream.getVideoTracks()];
  const sysOk = needSys && stream.getAudioTracks().length > 0;
  if (sysOk && needMic) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    [stream, micStream].forEach(s => audioCtx.createMediaStreamSource(s).connect(dest));
    tracks.push(...dest.stream.getAudioTracks());
  } else if (sysOk) tracks.push(...stream.getAudioTracks());
  else if (needMic) tracks.push(...micStream.getAudioTracks());
  return new MediaStream(tracks);
}

async function runCountdown(n) {
  const el = $("countdown");
  for (let i = n; i > 0; i--) { el.textContent = i; el.classList.add("show"); setStatus(`Starting in ${i}…`); await sleep(1000); }
  el.classList.remove("show");
}

async function startRecording() {
  if (!selectedSource || recorder || busy) return;
  busy = true; saveSettings();
  $("savedBox").hidden = true; $("startBtn").disabled = true;
  try {
    await runCountdown(Number($("countdown").value));
    const rs = await buildStream();
    const mimeType = MIMES.find(t => MediaRecorder.isTypeSupported(t)) || "";
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    recorder = new MediaRecorder(rs, { mimeType, videoBitsPerSecond: Number($("bitrate").value), audioBitsPerSecond: 192000 });
    await api.openFile(ext);
    bytesWritten = 0; writeChain = Promise.resolve();
    recorder.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      writeChain = writeChain.then(async () => {
        const buf = await e.data.arrayBuffer();
        await api.writeChunk(buf);
        bytesWritten += buf.byteLength;
      }).catch(err => setStatus(`Write error: ${err.message}`));
    };
    recorder.onstop = finish;
    recorder.onerror = e => { setStatus(`Recording error: ${e.error?.message || "unknown"}`); stopRecording(); };
    recorder.start(1000);
    startedAt = Date.now(); elapsedBeforePause = 0; isPaused = false;
    $("fmtStat").textContent = ext === "mp4" ? "MP4 · H.264" : "WebM";
    timerHandle = setInterval(() => {
      const el = elapsedBeforePause + (isPaused ? 0 : Date.now() - startedAt);
      $("timer").textContent = formatTime(el);
      $("sizeStat").textContent = mb(bytesWritten);
      $("meterFill").style.width = `${Math.min(100, (el % 60000) / 600)}%`;
    }, 250);
    $("pauseBtn").disabled = false; $("stopBtn").disabled = false; $("pauseBtn").textContent = "Pause";
    setStatus("Recording", true);
    stream.getVideoTracks()[0].addEventListener("ended", stopRecording);
    if ($("hideOnStart").checked) api.minimize();
  } catch (e) {
    setStatus(`Could not start: ${e.message}`);
    cleanupStream(); recorder = null; busy = false;
    $("startBtn").disabled = !selectedSource;
  }
}

function pauseResume() {
  if (!recorder) return;
  if (!isPaused && recorder.state === "recording") {
    elapsedBeforePause += Date.now() - startedAt;
    recorder.pause(); isPaused = true;
    $("pauseBtn").textContent = "Resume"; setStatus("Paused");
  } else if (isPaused && recorder.state === "paused") {
    recorder.resume(); startedAt = Date.now(); isPaused = false;
    $("pauseBtn").textContent = "Pause"; setStatus("Recording", true);
  }
}

function stopRecording() {
  if (!recorder || recorder.state === "inactive") return;
  recorder.stop();
  if (timerHandle) clearInterval(timerHandle);
  $("pauseBtn").disabled = true; $("stopBtn").disabled = true;
  $("meterFill").style.width = "0";
  setStatus("Saving video…");
}

async function finish() {
  try {
    await writeChain;
    const r = await api.closeFile();
    if (!r.bytes) throw new Error("The recording is empty.");
    lastFile = r.filePath;
    $("savedPath").textContent = r.filePath; $("savedBox").hidden = false;
    setStatus(`Saved · ${mb(r.bytes)}`);
  } catch (e) {
    setStatus(`Could not save video: ${e.message}`);
  } finally {
    cleanupStream(); recorder = null; busy = false;
    api.restore();
    $("timer").textContent = "00:00:00"; $("sizeStat").textContent = "0 MB";
    $("startBtn").disabled = !selectedSource;
  }
}

function cleanupStream() {
  [stream, micStream].forEach(s => s && s.getTracks().forEach(t => t.stop()));
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  stream = null; micStream = null;
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
  $("pauseBtn").disabled = true; $("stopBtn").disabled = true; $("pauseBtn").textContent = "Pause";
}

$("refreshSources").addEventListener("click", loadSources);
$("startBtn").addEventListener("click", startRecording);
$("pauseBtn").addEventListener("click", pauseResume);
$("stopBtn").addEventListener("click", stopRecording);
$("revealBtn").addEventListener("click", () => api.reveal(lastFile));
api.onHotkey(key => {
  if (key === "toggle") (recorder ? stopRecording() : startRecording());
  else pauseResume();
});
loadSources();
