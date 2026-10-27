#!/bin/sh
# demo-film.sh [--only шаг,шаг] [--ctx .state/films/<время>/manifest.json] - прогон сценария
# съёмки видео-демо (film/film.yml): участники действуют через API под своими учётками, камера
# (Playwright без окна, образ ai-factory-film/camera) снимает экраны. Клипы и журнал дубля
# (manifest.json: планы с попытками, события, клипы, версии) - в .state/films/<время>/ (рядом с
# ключами и входами камеры: трассы браузера хранят куки). Ключи и входы монтируются только для
# чтения - только ключи съёмки, ключей фабрики здесь нет. Перед съёмкой стенд сбрасывается
# (scripts/demo-reset.sh): прошлые дубли уходят из кадра. --ctx продолжает дубль в его же каталоге,
# без сброса стенда: сделанные планы пропускаются, --only переснимает названные планы. Запуск из
# корня репозитория; фабрика и стенд цели уже работают.
set -eu

# --preflight - только проверка готовности мира, чтением: стенд не сбрасывается.
case " $* " in *" --ctx "* | *" --preflight "*) ;; *) "$(dirname "$0")/demo-reset.sh" ;; esac
out=.state/films/$(date +%Y%m%d-%H%M%S)
# --ctx: журнал и клипы - в каталоге продолжаемого дубля, внутри камеры он - /out.
args=
next=
for a in "$@"; do
	if [ "$next" = ctx ]; then
		out=$(dirname "$a")
		case $out in .state/films/?*) ;; *)
			echo "--ctx: журнал дубля - .state/films/<время>/manifest.json" >&2
			exit 2
			;;
		esac
		a=/out/$(basename "$a")
	fi
	next=
	[ "$a" != --ctx ] || next=ctx
	args="$args $a"
done
mkdir -p "$out"
# Проверка без дубля не оставляет пустого каталога дубля.
case " $* " in *" --preflight "*) trap 'rmdir "$out" 2>/dev/null || true' EXIT ;; esac
# Версия съёмки в журнал: коммит и признак незаписанной правки.
ver=$(git rev-parse --short=12 HEAD 2>/dev/null || echo неизвестна)
git diff --quiet HEAD -- src film scripts 2>/dev/null || ver=$ver-правка
docker build -q -t ai-factory-film/camera -f Dockerfile . >/dev/null
# shellcheck disable=SC2086 # аргументы режиссёра - без пробелов внутри
docker run --rm --network host -u "$(scripts/host-user.sh)" -e HOME=/tmp -e TZ="${TZ:-$(cat /etc/timezone 2>/dev/null || echo UTC)}" \
	-e FILM_VERSION="$ver" -v "$PWD/film:/film:ro" -v "$PWD/.state:/state:ro" -v "$PWD/$out:/out" \
	ai-factory-film/camera /film/film.yml /out $args
echo "клипы: $out"
