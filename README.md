# TeslaPlay — Canvas Video Oynatici

Tesla araclarin surucu modunda `<video>` elementi bloklanir. Bu proje, YouTube videolarini **Canvas + WebSocket** mimarisiyle oynatir:

```
YouTube URL
    |
 yt-dlp (video URL al)
    |
 FFmpeg (JPEG kareler pipe et)
    |
 WebSocket -> <canvas>.drawImage()   (video)
    +-> /api/audio proxy            (ses, <audio> ile)
```

---

## Gereksinimler

| Araç | Kurulum |
|------|---------|
| **Node.js** >= 18 | https://nodejs.org |
| **yt-dlp** | `pip install yt-dlp` veya https://github.com/yt-dlp/yt-dlp |
| **ffmpeg** | `apt install ffmpeg` / `brew install ffmpeg` |

Kurulum kontrolu:
```bash
node --version   # v18+
yt-dlp --version
ffmpeg -version
```

---

## Kurulum ve Calistirma

```bash
# 1. Bagimliliklari yukle
npm install

# 2. Sunucuyu baslat
npm start
# veya gelistirme modunda (hot-reload):
npm run dev
```

Sunucu varsayilan olarak `http://localhost:3000` adresinde baslar.

---

## Tesla'dan Kullanim

1. Tesla'nin ayni Wi-Fi agina baglanin.
2. Sunucunun calistigi bilgisayarin IP adresini ogrenin:
   ```bash
   # Linux/Mac
   ip addr show | grep 'inet '
   # Windows
   ipconfig
   ```
3. Tesla tarayicisinda `http://<IP_ADRES>:3000` adresine gidin.
4. YouTube URL'sini yapistirin ve **Oynat** tusuna basin.

---

## Docker ile Calistirma

```bash
# Image'i olustur
docker build -t teslaplay .

# Konteyner'i calistir
docker run -p 3000:3000 teslaplay
```

---

## Proje Yapisi

```
Tesla-Canvas/
├── server.js          # Express + WebSocket sunucusu
├── public/
│   ├── index.html     # Arayuz (giris + oynatici ekrani)
│   └── player.js      # WebSocket istemcisi, canvas render dongusu
├── package.json
└── Dockerfile
```

---

## Nasil Calisir?

- **Video:** `yt-dlp` ile video stream URL'si alinir, `ffmpeg` bu URL'yi JPEG karelerine donusturur ve WebSocket uzerinden istemciye gonderilir. Istemci `<canvas>` uzerinde `drawImage()` ile gosterir.
- **Ses:** `yt-dlp` ile ses stream URL'si alinir, sunucu HTTP proxy olarak calismaya devam eder. Istemci `<audio autoplay>` ile sesi calar. Tesla surucu modunda `<audio>` calismaya devam eder.

---

## Sorun Giderme

| Sorun | Cozum |
|-------|-------|
| Sayfa acilmiyor | Guvenlik duvari 3000 portunu bloke ediyor olabilir |
| "Eksik bagimlilik" uyarisi | `yt-dlp` veya `ffmpeg` PATH'de bulunamadi |
| Ses gelmiyor | Tesla surucu modunda ses otomatik baslatma kisitlanmis olabilir, ekrana dokunun |
| Yuksek gecikme | Ag baglantisinizi kontrol edin; FFmpeg `fps` ve `scale` parametrelerini dusurun |
