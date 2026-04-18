FROM node:20-slim

# ffmpeg ve yt-dlp icin gerekli araclari yukle
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && pip3 install --break-system-packages yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# EJS (YouTube JS challenge cozucu) GitHub'dan indir ve image'e bake et
# Build sirasinda YouTube'a erisim gerekmiyor, sadece GitHub'dan script indirir
RUN yt-dlp --js-runtimes node --remote-components ejs:github \
    --print title "https://www.youtube.com/watch?v=BaW_jenozKc" 2>&1 || true

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
