const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { spawn } = require("child_process");
const http = require("http");
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
  const base = ["--no-playlist", "--js-runtimes", "node", "--remote-components", "ejs:github",
                "--extractor-args", "youtube:player_client=web", ...extraArgs, url];
  return YT_COOKIES ? ["--cookies", YT_COOKIES, ...base] : base;
}

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

// Video + ses URL'lerini tek yt-dlp cagrisiyla al, WebSocket ile gonder
// bestvideo+bestaudio formati: 2 satir cikti (video URL, audio URL)
// combined format: 1 satir cikti (sadece video URL)
wss.on("connection", (ws, req) => {
  const params = new URL(req.url, "http://localhost").searchParams;
  const youtubeUrl = params.get("url");
  if (!youtubeUrl) return ws.close(1008, "URL eksik");

  console.log("[+] Yeni baglanti:", youtubeUrl);
  let ffmpegProc = null;

  const ytDlp = spawn("yt-dlp", ytdlpArgs(
    ["-f", "bestvideo[height<=480]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best", "--get-url"],
    youtubeUrl
  ));

  let rawUrls = "";
  ytDlp.stdout.on("data", (d) => (rawUrls += d.toString()));
  ytDlp.stderr.on("data", (d) => process.stderr.write(d));

  ytDlp.on("close", (code) => {
    const lines = rawUrls.trim().split("\n").map(l => l.trim()).filter(Boolean);
    const videoUrl = lines[0];
    const audioUrl = lines[1] || null;

    if (code !== 0 || !videoUrl) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", msg: "Video URL alinamadi" }));
        ws.close();
      }
      return;
    }

    // Ses URL'si varsa (DASH stream) WebSocket ile gonder
    if (audioUrl && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "audio", url: audioUrl }));
      console.log("[~] Ses URL'si gonderildi");
    }

    console.log("[~] FFmpeg baslatiliyor...");
    ffmpegProc = spawn("ffmpeg", [
      "-i", videoUrl,
      "-vf", "fps=15,scale=426:-2",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "-q:v", "10",
      "-threads", "1",
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
