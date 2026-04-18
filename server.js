const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { spawn } = require("child_process");
const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/video" });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Cookie destegi: YT_COOKIES_B64 (Render icin base64) veya YT_COOKIES_FILE (local icin dosya yolu)
const COOKIES_TMP = "/tmp/yt-cookies.txt";
let YT_COOKIES = null;

if (process.env.YT_COOKIES_B64) {
  fs.writeFileSync(COOKIES_TMP, Buffer.from(process.env.YT_COOKIES_B64, "base64").toString("utf-8"));
  YT_COOKIES = COOKIES_TMP;
  console.log("[*] Cookie dosyasi yuklendi (/tmp/yt-cookies.txt)");
} else if (process.env.YT_COOKIES_FILE) {
  YT_COOKIES = process.env.YT_COOKIES_FILE;
}

function ytdlpArgs(extraArgs, url) {
  const base = ["--no-playlist", "--js-runtimes", "node", "--remote-components", "ejs:github", ...extraArgs, url];
  return YT_COOKIES ? ["--cookies", YT_COOKIES, ...base] : base;
}

// Bagimlilik kontrolu
// ffmpeg: -version (tek tire), yt-dlp: --version (cift tire)
function checkDependency(cmd, args) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

app.get("/api/check", async (req, res) => {
  const [ytdlp, ffmpeg] = await Promise.all([
    checkDependency("yt-dlp", ["--version"]),
    checkDependency("ffmpeg", ["-version"]),
  ]);
  res.json({ ytdlp, ffmpeg, ok: ytdlp && ffmpeg });
});

// Ses proxy - <audio> Tesla drive modunda calismaya devam eder
app.get("/api/audio", (req, res) => {
  const youtubeUrl = req.query.url;
  if (!youtubeUrl) return res.status(400).json({ error: "URL eksik" });

  const ytDlp = spawn("yt-dlp", ytdlpArgs(
    ["-f", "bestaudio[ext=m4a]/bestaudio", "--get-url"],
    youtubeUrl
  ));

  let audioUrl = "";
  ytDlp.stdout.on("data", (d) => (audioUrl += d.toString()));
  ytDlp.stderr.on("data", () => {});

  ytDlp.on("close", (code) => {
    audioUrl = audioUrl.trim().split("\n")[0];
    if (code !== 0 || !audioUrl) {
      return res.status(500).json({ error: "Ses URL alinamadi" });
    }
    const lib = audioUrl.startsWith("https") ? https : http;
    lib.get(audioUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (audioRes) => {
      res.setHeader("Content-Type", audioRes.headers["content-type"] || "audio/mp4");
      res.setHeader("Cache-Control", "no-cache");
      audioRes.pipe(res);
      res.on("close", () => audioRes.destroy());
    }).on("error", () => res.status(500).json({ error: "Ses proxy hatasi" }));
  });
});

// Video frame WebSocket
// Tesla <video> elementini bloklar ama <canvas> gecer.
// FFmpeg -> JPEG kareler -> WebSocket -> canvas.drawImage()
wss.on("connection", (ws, req) => {
  const params = new URL(req.url, "http://localhost").searchParams;
  const youtubeUrl = params.get("url");
  if (!youtubeUrl) return ws.close(1008, "URL eksik");

  console.log("[+] Yeni baglanti:", youtubeUrl);
  let ffmpegProc = null;

  const ytDlp = spawn("yt-dlp", ytdlpArgs(
    ["-f", "bestvideo[height<=480][ext=mp4]/bestvideo[height<=480]/best[height<=480]/best", "--get-url"],
    youtubeUrl
  ));

  let videoUrl = "";
  ytDlp.stdout.on("data", (d) => (videoUrl += d.toString()));
  ytDlp.stderr.on("data", (d) => process.stderr.write(d));

  ytDlp.on("close", (code) => {
    videoUrl = videoUrl.trim().split("\n")[0];
    if (code !== 0 || !videoUrl) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", msg: "Video URL alinamadi" }));
        ws.close();
      }
      return;
    }

    console.log("[~] FFmpeg baslatiliyor...");
    ffmpegProc = spawn("ffmpeg", [
      "-i", videoUrl,
      "-vf", "fps=24,scale=640:-2",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "-q:v", "5",
      "-an",
      "pipe:1",
    ]);

    let buf = Buffer.alloc(0);

    ffmpegProc.stdout.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const soi = buf.indexOf(Buffer.from([0xff, 0xd8]));
        if (soi === -1) { buf = Buffer.alloc(0); break; }
        const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 2);
        if (eoi === -1) break;
        const frame = buf.slice(soi, eoi + 2);
        buf = buf.slice(eoi + 2);
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    });

    ffmpegProc.stderr.on("data", () => {});
    ffmpegProc.on("close", () => {
      console.log("[-] FFmpeg kapandi");
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });
  });

  ws.on("close", () => { if (ffmpegProc) ffmpegProc.kill(); });
  ws.on("error", () => { if (ffmpegProc) ffmpegProc.kill(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("\n Tesla Canvas Player calisiyor");
  console.log("   Adres  : http://localhost:" + PORT);
  console.log("   Tesla  : Tarayicidan bu adrese gir ve YouTube URL yapistir\n");
});
