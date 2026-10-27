#!/bin/sh
# slides-render.sh - картинки слайдов нарезок: film/slides/<имя>.html (разделы колоды Claude Design
# "Слайды видео-демо фабрики") -> film/slides/<имя>.png (scripts/slides.mjs в образе камеры).
# Картинка слайда входит в отпечаток нарезки: после правки слайда страж свежести требует перевыпуск
# роликов с ним. Запуск из корня репозитория.
set -eu

docker build -q -t ai-factory-film/camera -f Dockerfile . >/dev/null
docker run --rm --network none -u "$(scripts/host-user.sh)" -e HOME=/tmp -v "$PWD/film/slides:/slides" -v "$PWD/film/fonts:/fonts:ro" \
	-v "$PWD/scripts:/scripts:ro" --entrypoint node ai-factory-film/camera /scripts/slides.mjs /slides /fonts
