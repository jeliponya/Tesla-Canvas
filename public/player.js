const inputScreen      = document.getElementById("input-screen");
const playerScreen     = document.getElementById("player-screen");
const canvas           = document.getElementById("canvas");
const ctx              = canvas.getContext("2d");
const audio            = document.getElementById("audio");
const urlInput         = document.getElementById("url-input");
const playBtn          = document.getElementById("play-btn");
const statusEl         = document.getElementById("status");
const backBtn          = document.getElementById("back-btn");
const pauseBtn         = document.getElementById("pause-btn");
const loadingIndicator = document.getElementById("loading-indicator");
const fpsBadge         = document.getElementById("fps-badge");
const depWarning       = document.getElementById("dep-warning");

let ws = null, animFrameId = null, paused = false;
const frameQueue = [];
let frameCount = 0, lastFpsCheck = Date.now(), firstFrame = true;

function setStatus(msg, type) { statusEl.textContent = msg; statusEl.className = type || ""; }
function setLoading(msg) { loadingIndicator.innerHTML = msg ? "<span class='spinner'></span>" + msg : ""; }

(async () => {
  try {
    const data = await fetch("/api/check").then(r => r.json());
    if (!data.ok) {
      const missing = [];
      if (!data.ytdlp) missing.push("yt-dlp");
      if (!data.ffmpeg) missing.push("ffmpeg");
      depWarning.style.display = "block";
      depWarning.textContent = "Eksik bagimlilik: " + missing.join(", ") + ". Lutfen yukleyin.";
      playBtn.disabled = true;
    }
  } catch {}
})();

function renderLoop() {
  animFrameId = requestAnimationFrame(renderLoop);
  if (!frameQueue.length || paused) return;
  const bitmap = frameQueue.shift();
  if (firstFrame) {
    firstFrame = false;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    inputScreen.style.display = "none";
    playerScreen.style.display = "flex";
    pauseBtn.style.display = "inline-block";
    setLoading("");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  frameCount++;
  const now = Date.now();
  if (now - lastFpsCheck >= 1000) {
    fpsBadge.textContent = frameCount + " fps";
    frameCount = 0; lastFpsCheck = now;
  }
}

function startPlayer(youtubeUrl) {
  playBtn.disabled = true; firstFrame = true; paused = false;
  pendingAudioUrl = null; audioReady = false;
  frameQueue.length = 0; pauseBtn.style.display = "none";
  pauseBtn.textContent = "Duraklat";
  setStatus(""); setLoading("Baglaniyor...");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(proto + "//" + location.host + "/ws/video?url=" + encodeURIComponent(youtubeUrl));
  ws.binaryType = "arraybuffer";
  ws.onopen = () => setLoading("Video hazirlaniyor...");
  ws.onmessage = async (event) => {
    if (typeof event.data === "string") {
      try {
        const m = JSON.parse(event.data);
        if (m.type === "error") { setLoading(""); setStatus(m.msg, "error"); playBtn.disabled = false; }
        if (m.type === "audio" && m.url) { audio.src = m.url; audio.play().catch(() => {}); }
      } catch {}
      return;
    }
    try {
      const bitmap = await createImageBitmap(new Blob([event.data], { type: "image/jpeg" }));
      if (frameQueue.length < 4) frameQueue.push(bitmap); else bitmap.close();
    } catch {}
  };
  ws.onerror = () => { setLoading(""); setStatus("Baglanti hatasi", "error"); playBtn.disabled = false; };
  ws.onclose = () => { setLoading(""); playBtn.disabled = false; };
  if (animFrameId) cancelAnimationFrame(animFrameId);
  renderLoop();
}

function stopPlayer() {
  if (ws) { ws.close(); ws = null; }
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  while (frameQueue.length) frameQueue.shift().close();
  audio.pause(); audio.src = "";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  playerScreen.style.display = "none";
  inputScreen.style.display = "flex";
  paused = false; pauseBtn.style.display = "none";
  playBtn.disabled = false; fpsBadge.textContent = "";
  setStatus(""); setLoading("");
}

function togglePause() {
  paused = !paused;
  if (paused) {
    audio.pause();
    while (frameQueue.length) frameQueue.shift().close();
    pauseBtn.textContent = "Devam";
  } else {
    audio.play().catch(() => {});
    pauseBtn.textContent = "Duraklat";
  }
}

playBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (!url) return setStatus("Lutfen bir YouTube URL girin", "error");
  audio.load(); // kullanici gestureu ile audio unlock
  startPlayer(url);
});
backBtn.addEventListener("click", stopPlayer);
pauseBtn.addEventListener("click", togglePause);
urlInput.addEventListener("keydown", e => { if (e.key === "Enter") playBtn.click(); });
