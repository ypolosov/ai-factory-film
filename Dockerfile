# Камера видео-демо: Playwright без окна той же версии, что у сквозных проверок цели, и режиссёр
# src/film.ts (Node стирает типы). Кода фабрики в образе нет: съёмка - отдельная система.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /opt/film
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src/*.ts ./src/
ENTRYPOINT ["node", "/opt/film/src/film.ts"]
