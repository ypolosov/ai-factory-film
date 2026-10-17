#!/bin/sh
# demo-film.sh [--only шаг,шаг] [--ctx .state/films/<время>/manifest.json] - прогон сценария
# съёмки видео-демо (film/film.yml): участники действуют через API под своими учётками, камера
# (Playwright без окна, образ ai-factory-film/camera) снимает экраны. Клипы и журнал дубля
# (manifest.json, пишется после каждого шага) - в .state/films/<время>/ (рядом с ключами и входами
# камеры: трассы браузера хранят куки). Ключи и входы монтируются только для чтения - только ключи
# съёмки, ключей фабрики здесь нет. Перед съёмкой стенд сбрасывается (scripts/demo-reset.sh):
# прошлые дубли уходят из кадра. --ctx продолжает прерванный дубль с итогами из его журнала - без
# сброса стенда; сделанные шаги пропускаются. Запуск из корня репозитория; фабрика и стенд цели уже
# работают.
set -eu

case " $* " in *" --ctx "*) ;; *) "$(dirname "$0")/demo-reset.sh" ;; esac
out=.state/films/$(date +%Y%m%d-%H%M%S)
mkdir -p "$out"
# --ctx путь в каталоге состояния: внутри камеры он - под /state.
args=
for a in "$@"; do args="$args $(printf '%s' "$a" | sed 's#^\.state/#/state/#')"; done
docker build -q -t ai-factory-film/camera -f Dockerfile . >/dev/null
# shellcheck disable=SC2086 # аргументы режиссёра - без пробелов внутри
docker run --rm --network host -u "$(id -u):$(id -g)" -e HOME=/tmp -e TZ="${TZ:-$(cat /etc/timezone 2>/dev/null || echo UTC)}" \
	-v "$PWD/film:/film:ro" -v "$PWD/.state:/state:ro" -v "$PWD/$out:/out" \
	ai-factory-film/camera /film/film.yml /out $args
echo "клипы: $out"
