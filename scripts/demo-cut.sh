#!/bin/sh
# demo-cut.sh КАТАЛОГ_ДУБЛЯ [КАТАЛОГ...] [ВИДЕО.mp4] - черновая склейка дубля видео-демо: клипы
# камеры в порядке журнала (manifest.json, scripts/demo-film.sh: по порядку сценария, у переснятого
# плана - клипы последней удачной попытки), у каждого - подпись внизу кадра. Продолжение дубля
# (--ctx) пишет в его же каталог; несколько каталогов - дубли, снятые до этого, по порядку каталогов.
# Карточки глав и клипы чата Discord уже среди клипов журнала. Заставка и концовка - из журнала
# первого каталога (E.17): дата прогона, отметка версий, кто играет роли, что сделано; ссылки на
# задачи, PR и страницы - файлом рядом с роликом (<ролик>-links.md, для описания). Нужны ffmpeg и
# шрифт DejaVu Sans (кириллица). По умолчанию - draft.mp4 в первом каталоге.
# Пример: scripts/demo-cut.sh .state/films/20261016-174550 .state/films/20261016-174550-b
set -eu

[ $# -ge 1 ] || {
	echo "использование: demo-cut.sh КАТАЛОГ_ДУБЛЯ [КАТАЛОГ...] [ВИДЕО.mp4]" >&2
	exit 2
}
out=$1/draft.mp4
dirs=
for a in "$@"; do
	case $a in *.mp4) out=$a ;; *)
		[ -s "$a/manifest.json" ] || {
			echo "нет $a/manifest.json - это не каталог дубля" >&2
			exit 2
		}
		dirs="$dirs $a"
		;;
	esac
done
font=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf}
[ -s "$font" ] || {
	echo "нет шрифта $font (FONT=путь к шрифту с кириллицей)" >&2
	exit 2
}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

# card ЗАГОЛОВОК.txt ТЕКСТ.txt СЕКУНД ВЫХОД.mp4 - карточка на фоне глав, того же вида, что клипы.
card() {
	ffmpeg -nostdin -v error -y -f lavfi -i "color=c=0x14111F:s=1280x720:r=30:d=$3" \
		-vf "drawtext=fontfile=$font:textfile=$1:fontsize=44:fontcolor=white:x=(w-text_w)/2:y=h/2-160,drawtext=fontfile=$font:textfile=$2:fontsize=26:fontcolor=0xC9C3E6:line_spacing=14:x=(w-text_w)/2:y=h/2-60" \
		-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -an "$4"
}
first=${dirs# }
m=${first%% *}/manifest.json
when=$(date -d "$(jq -r .started "$m")" '+%d.%m.%Y %H:%M')
jq -r .title "$m" >"$tmp/title.txt"
jq -r --arg when "$when" '((.runs // [])[0] // {}) as $r
	| "Прогон фабрики ПО на ИИ, \($when)",
	"Все роли играют ИИ-персонажи; работу фабрики делает ИИ вживую",
	"",
	"Версии: съёмка \(($r.film // "?")[0:7]), сценарий \(($r.script // "?")[0:8]), фабрика \(($r.factory // "?")[0:7]), цель \(($r.target // "?")[0:7])"' "$m" >"$tmp/intro.txt"
# Что сделано - объекты дубля: задачи, PR и страницы из итогов шагов и ссылки из ответов фабрики
# (правило-кандидат, заметки о выпуске), но не старше первого объекта дубля - ответ !учёт, например,
# ссылается и на PR прошлых прогонов. Номера задач и PR растут со временем, номера страниц
# Confluence - нет: страницы берутся все.
jq -r '[.ctx[]? | objects | (.issue?, .issues[]?, .pr?, .page?) | objects | .url? | strings] as $own
	| ([$own[] | capture("/browse/[A-Z]+-(?<n>[0-9]+)$").n | tonumber] | min // 0) as $i0
	| ([$own[] | capture("/pull/(?<n>[0-9]+)").n | tonumber] | min // 0) as $p0
	| ($own + [.ctx[]? | objects | .reply?.url? | strings]) | unique as $l
	| ([$l[] | capture("/browse/(?<k>[A-Z]+-(?<n>[0-9]+))$") | select((.n | tonumber) >= $i0) | .k] | unique) as $issues
	| ([$l[] | capture("github.com/[^/]+/[^/]+/pull/(?<n>[0-9]+)").n | tonumber | select(. >= $p0)] | unique | map(tostring)) as $prs
	| ([$l[] | capture("/wiki/.*/pages/(?<n>[0-9]+)").n] | unique | length) as $pages
	| "Задачи Jira: \($issues | length) (\($issues | join(", ")))",
	"PR: \($prs | length) (\($prs | map("#" + .) | join(", ")))",
	"Страницы Confluence: \($pages)",
	"",
	"Ссылки на задачи, PR и страницы - в описании ролика"' "$m" >"$tmp/outro.txt"
echo "Что сделано в прогоне" >"$tmp/outro-title.txt"
card "$tmp/title.txt" "$tmp/intro.txt" 6 "$tmp/000.mp4"
printf "file '%s'\n" "$tmp/000.mp4" >"$tmp/list.txt"
links=${out%.mp4}-links.md
jq -r '"# Ссылки прогона \(.take) - \(.title)", "", (.plans // {} | to_entries[] | select((.value.links // []) | length > 0) | "- \(.key): \(.value.links | join(" "))")' "$m" >"$links"

# Клип -> mp4 одного вида (1280x720, 30 кадров) с подписью из файла: текст подписи не нужно экранировать.
# shellcheck disable=SC2086 # каталоги дубля - без пробелов в именах
for dir in $dirs; do jq -r --arg d "$dir" '.clips[] | [$d + "/" + .file, .caption] | @tsv' "$dir/manifest.json"; done >"$tmp/clips"
n=0
while IFS="$(printf '\t')" read -r file caption; do
	n=$((n + 1))
	part=$(printf '%s/%03d.mp4' "$tmp" "$n")
	printf '%s' "$caption" >"$tmp/caption-$n.txt"
	ffmpeg -nostdin -v error -y -i "$file" \
		-vf "scale=1280:720,fps=30,drawtext=fontfile=$font:textfile=$tmp/caption-$n.txt:fontsize=26:fontcolor=white:box=1:boxcolor=0x14111F@0.78:boxborderw=14:x=24:y=h-th-40" \
		-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -an "$part"
	printf "file '%s'\n" "$part" >>"$tmp/list.txt"
	echo "клип $n: $file"
done <"$tmp/clips"
card "$tmp/outro-title.txt" "$tmp/outro.txt" 8 "$tmp/999.mp4"
printf "file '%s'\n" "$tmp/999.mp4" >>"$tmp/list.txt"
ffmpeg -nostdin -v error -y -f concat -safe 0 -i "$tmp/list.txt" -c copy "$out"
echo "склейка: $out ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out" | cut -d. -f1) с), ссылки: $links"
