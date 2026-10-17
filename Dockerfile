# Камера видео-демо: Playwright без окна той же версии, что у сквозных проверок цели, и режиссёр
# src/film.ts (Node стирает типы). Кода фабрики в образе нет: съёмка - отдельная система.
# Выпуск роликов (src/release.ts): ffmpeg, шрифт с кириллицей для субтитров, голос edge-tts.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core python3-venv \
	&& rm -rf /var/lib/apt/lists/* \
	&& python3 -m venv /opt/tts && /opt/tts/bin/pip install --no-cache-dir edge-tts==7.3.1
WORKDIR /opt/film
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src/*.ts ./src/
ENTRYPOINT ["node", "/opt/film/src/film.ts"]
