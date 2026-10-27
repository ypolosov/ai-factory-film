#!/bin/sh
# demo-release.sh [--check] [--from-journal] [--only нарезка,нарезка] [КАТАЛОГ_ДУБЛЯ] - ролики видео-демо
# из журнала дубля по нарезкам film/cuts.yml (src/release.ts) в .state/releases/: ролик и ссылки для
# описания на каждую нарезку, журнал публикаций releases.json с отметкой версий.
# Дубль по умолчанию - последний полный (все планы сценария сделаны). Сначала - страж свежести:
# изменились сценарий или фабрика после дубля - снимается новый дубль (scripts/demo-film.sh), и ролики
# собираются из него; изменилась только нарезка - перевыпуск из журнала без съёмки.
#   --check         только страж свежести, без сборки (код 0 - свежие, 1 - перевыпуск, 3 - новый дубль);
#   --from-journal  собрать из журнала, даже если страж просит новый дубль.
# Запуск из корня репозитория.
set -eu

check=
journal=
only=
take=
while [ $# -gt 0 ]; do
	case $1 in
	--check) check=1 ;;
	--from-journal) journal=1 ;;
	--only)
		only=$2
		shift
		;;
	*) take=${1%/} ;;
	esac
	shift
done
steps=$(grep -c '^  - id: ' film/film.yml)
# latest - последний каталог дубля, где сделаны все планы сценария.
latest() {
	for d in $(find .state/films -mindepth 1 -maxdepth 1 -type d | sort -r); do
		[ -s "$d/manifest.json" ] || continue
		if [ "$(jq '[.plans // {} | .[] | select(.status == "done")] | length' "$d/manifest.json")" -ge "$steps" ]; then
			echo "$d"
			return 0
		fi
	done
	return 1
}
[ -n "$take" ] || take=$(latest) || {
	echo "нет полного дубля в .state/films - снимите: scripts/demo-film.sh" >&2
	exit 2
}
mkdir -p .state/releases
docker build -q -t ai-factory-film/camera -f Dockerfile . >/dev/null
# release АРГУМЕНТЫ... - выпуск в образе камеры: дубль только для чтения, выпуск - в .state/releases.
release() {
	_take=$1
	shift
	docker run --rm --network host -u "$(scripts/host-user.sh)" -e HOME=/tmp -e TZ="${TZ:-$(cat /etc/timezone 2>/dev/null || echo UTC)}" \
		-v "$PWD/film:/film:ro" -v "$PWD/$_take:/take:ro" -v "$PWD/.state/releases:/out" --entrypoint node \
		ai-factory-film/camera /opt/film/src/release.ts /film/film.yml /film/cuts.yml /take /out ${only:+--only "$only"} "$@"
}
echo "дубль: $take"
set +e
release "$take" --check
fresh=$?
set -e
[ -z "$check" ] || exit "$fresh"
if [ "$fresh" = 3 ] && [ -z "$journal" ]; then
	echo "страж: нужен новый дубль - снимаю (scripts/demo-film.sh)"
	"$(dirname "$0")/demo-film.sh"
	take=$(latest)
	echo "дубль: $take"
fi
# Окно Discord (решение владельца 27.10, РП 60): окно на связи (scripts/discord-browser.sh), а в журнале
# клипы чата - запись окна их заменяет (scripts/demo-discord.sh); окна нет - в роликах чат из журнала.
if node scripts/cdp.mjs status >/dev/null 2>&1 && jq -e '[.clips[].file | select(endswith("-chat.webm"))] | length > 0' "$take/manifest.json" >/dev/null; then
	"$(dirname "$0")/demo-discord.sh" "$take" || echo "запись окна Discord не вышла - в роликах чат из журнала" >&2
fi
release "$take"
