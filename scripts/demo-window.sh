#!/bin/sh
# demo-window.sh КАТАЛОГ_ДУБЛЯ - запись окна браузера через OBS по журналу дубля (решения владельца
# 18.10): окно Discord и Figma в роликах - настоящее окно, а не кадр камеры без окна.
# - Discord: для каждого шага с перепиской окно переходит по адресу первого сообщения шага (id - в
#   журнале, ctx.<шаг>.discord); запись встаёт вместо клипа чата - <шаг>-chat.mp4.
# - Кадры с window в сценарии (Figma): окно переходит по адресу кадра (clips[].window); запись встаёт
#   вместо клипа камеры - <клип>.mp4.
# Карточка главы, если клип её начинал, ставится перед записью. От учётки владельца ничего не
# пишется; переходы запускает скрипт.
# Нужны: окно браузера (scripts/discord-browser.sh, вход в Discord и Figma сделан); OBS с сервером
# WebSocket и сценой с захватом окна - какое окно ловить и как вписать в холст, скрипт задаёт сам
# (obs.mjs window); .state/obs.env - OBS_WS_PASSWORD, по желанию OBS_SCENE и OBS_WS_URL.
# Запуск из корня репозитория; нужны node (22+), jq, ffmpeg и wslpath (WSL).
set -eu

take=${1:?использование: demo-window.sh КАТАЛОГ_ДУБЛЯ}
take=${take%/}
m=$take/manifest.json
[ -s "$m" ] || {
	echo "нет $m - это не каталог дубля" >&2
	exit 2
}
[ -s .state/obs.env ] || {
	echo "нет .state/obs.env: OBS_WS_PASSWORD=<пароль сервера WebSocket OBS>" >&2
	exit 2
}
obs() { node scripts/obs.mjs "$@" </dev/null; }
node scripts/cdp.mjs status </dev/null
obs version
scene=$(sed -n 's/^OBS_SCENE=//p' .state/obs.env | tr -d '\r"')
[ -z "$scene" ] || obs scene "$scene"
font=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
enc='-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -r 30 -an'

# record АДРЕС СЕКУНДЫ ДОРИСОВКА ШАГ ВЫХОД КАРТОЧКА ПОЯСНЕНИЕ - окно по адресу, OBS пишет СЕКУНДЫ,
# запись 1280x720 без звука (с карточкой главы, если она дана) - в ВЫХОД.
record() {
	url=$1 secs=$2 settle=$3 step=$4 dest=$5 title=$6 note=$7
	try=1
	while :; do
		# Заголовок окна меняется со страницей: OBS ловит окно браузера по нему, а не чужое окно.
		obs window "$(node scripts/cdp.mjs open "$url" </dev/null)" >/dev/null
		# Страница дорисовывается после загрузки: Discord подсвечивает сообщение, Figma рисует холст.
		sleep "$settle"
		obs start >/dev/null
		sleep "$secs"
		win=$(obs stop)
		sleep 2
		src=$(wslpath -u "$win")
		# Чёрные кадры - OBS потерял окно (заголовок сменился во время записи): переснять.
		black=$(ffmpeg -nostdin -i "$src" -vf blackdetect=d=0.5:pix_th=0.05 -an -f null - 2>&1 | grep -c black_start || true)
		[ "$black" -gt 0 ] || break
		[ $try -lt 3 ] || {
			echo "$step: окно не поймано 3 раза, чёрные кадры в $src" >&2
			exit 1
		}
		try=$((try + 1))
	done
	# shellcheck disable=SC2086 # параметры кодека - через пробел
	ffmpeg -nostdin -v error -y -i "$src" \
		-vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x1E1F24,fps=30" $enc "$tmp/body.mp4"
	if [ -n "$title" ]; then
		printf '%s' "$title" >"$tmp/title.txt"
		printf '%s' "$note" >"$tmp/note.txt"
		# shellcheck disable=SC2086
		ffmpeg -nostdin -v error -y -f lavfi -i "color=c=0x14111F:s=1280x720:r=30:d=2.5" \
			-vf "drawtext=fontfile=$font:textfile=$tmp/title.txt:fontsize=44:fontcolor=white:x=(w-text_w)/2:y=h/2-40,drawtext=fontfile=$font:textfile=$tmp/note.txt:fontsize=22:fontcolor=0xC9C3E6:x=(w-text_w)/2:y=h/2+30" \
			$enc "$tmp/card.mp4"
		# shellcheck disable=SC2086
		ffmpeg -nostdin -v error -y -i "$tmp/card.mp4" -i "$tmp/body.mp4" -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" $enc "$dest"
	else
		cp "$tmp/body.mp4" "$dest"
	fi
}

# replace ШАГ СТЕБЕЛЬ ФАЙЛ ПОДПИСЬ - клип шага с этим именем (без расширения) в журнале - на ФАЙЛ.
replace() {
	jq --arg s "$1" --arg stem "$2" --arg f "$3" --arg c "$4" '
		def fix: if .step == $s and (.file | sub("\\.[a-z0-9]+$"; "")) == $stem then .file = $f | (if $c != "" then .caption = $c else . end) else . end;
		.plans[$s].clips |= map(fix) | .clips |= map(fix)' "$m" >"$tmp/m.json"
	cp "$tmp/m.json" "$m"
}

jq -r '.ctx | to_entries[] | select(.value | type == "object" and has("discord"))
	| [.key, .value.discord.guild, .value.discord.channelId, .value.discord.messages[0], .value.discord.channel,
	(.value.discord.chars // 0), (.value.discord.card.title // ""), (.value.discord.card.note // "")] | @tsv' "$m" >"$tmp/steps"
jq -r '.plans | to_entries[] | .key as $s | .value.clips[]? | select(.window)
	| [$s, (.file | sub("\\.[a-z0-9]+$"; "")), .window.url, .window.seconds, (.window.card.title // ""), (.window.card.note // "")] | @tsv' "$m" >"$tmp/windows"
[ -s "$tmp/steps" ] || [ -s "$tmp/windows" ] || {
	echo "в журнале нет ни сообщений шагов (ctx.<шаг>.discord), ни кадров окна - сначала: scripts/demo-film.sh --ctx $m --chat" >&2
	exit 2
}
while IFS="$(printf '\t')" read -r step guild ch msg name chars title note; do
	secs=$((6 + chars / 150))
	[ "$secs" -le 14 ] || secs=14
	record "https://discord.com/channels/$guild/$ch/$msg" "$secs" 2 "$step" "$take/$step-chat.mp4" "$title" "$note"
	replace "$step" "$step-chat" "$step-chat.mp4" "Discord, #$name"
	echo "$step: окно Discord #$name, $secs с - $take/$step-chat.mp4"
done <"$tmp/steps"
while IFS="$(printf '\t')" read -r step stem url secs title note; do
	# Холст Figma рисуется после загрузки страницы: запас - WINDOW_SETTLE секунд (по умолчанию 10).
	record "$url" $((secs + 1)) "${WINDOW_SETTLE:-10}" "$step" "$take/$stem.mp4" "$title" "$note"
	replace "$step" "$stem" "$stem.mp4" ""
	echo "$step: окно $url, $secs с - $take/$stem.mp4"
done <"$tmp/windows"
