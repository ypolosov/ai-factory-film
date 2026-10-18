#!/bin/sh
# demo-discord.sh КАТАЛОГ_ДУБЛЯ - запись окна Discord через OBS по журналу дубля (решение владельца
# 18.10, вариант браузера): для каждого шага с перепиской скрипт переводит окно Discord в браузере
# (scripts/discord-browser.sh) по адресу первого сообщения шага (id - в журнале, ctx.<шаг>.discord),
# OBS пишет окно, запись встаёт в журнал вместо клипа чата - <шаг>-chat.mp4 (с карточкой главы, если
# клип чата начинал главу). От учётки владельца ничего не пишется; переходы запускает скрипт.
# Нужны: окно Discord (scripts/discord-browser.sh, вход сделан); OBS с сервером WebSocket и сценой с
# захватом окна - какое окно ловить и как вписать в холст, скрипт задаёт сам (obs.mjs window);
# .state/obs.env - OBS_WS_PASSWORD, по желанию OBS_SCENE и OBS_WS_URL.
# Запуск из корня репозитория; нужны node (22+), jq, ffmpeg и wslpath (WSL).
set -eu

take=${1:?использование: demo-discord.sh КАТАЛОГ_ДУБЛЯ}
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

jq -r '.ctx | to_entries[] | select(.value | type == "object" and has("discord"))
	| [.key, .value.discord.guild, .value.discord.channelId, .value.discord.messages[0], .value.discord.channel,
	(.value.discord.chars // 0), (.value.discord.card.title // ""), (.value.discord.card.note // "")] | @tsv' "$m" >"$tmp/steps"
[ -s "$tmp/steps" ] || {
	echo "в журнале нет сообщений шагов (ctx.<шаг>.discord) - сначала: scripts/demo-film.sh --ctx $m --chat" >&2
	exit 2
}
while IFS="$(printf '\t')" read -r step guild ch msg name chars title note; do
	secs=$((6 + chars / 150))
	[ "$secs" -le 14 ] || secs=14
	try=1
	while :; do
		# Заголовок окна меняется с каналом: OBS ловит окно браузера по нему, а не чужое окно Discord.
		obs window "$(node scripts/cdp.mjs open "https://discord.com/channels/$guild/$ch/$msg" </dev/null)" >/dev/null
		# Discord подсвечивает сообщение после перехода, OBS заново находит окно.
		sleep 2
		obs start >/dev/null
		sleep "$secs"
		win=$(obs stop)
		sleep 2
		src=$(wslpath -u "$win")
		# Пустой кадр - чёрный (OBS потерял окно) или ровный серый (браузер не рисует окно): переснять
		# шаг. Кадр середины записи ниже заголовка окна: разброс яркости меньше 24 - пусто.
		spread=$(ffmpeg -nostdin -ss "$((secs / 2))" -i "$src" -frames:v 1 -vf "crop=iw:ih*0.85:0:ih*0.1,signalstats,metadata=print:file=-" -f null - 2>/dev/null |
			awk -F= '/YMAX=/{max=$2} /YMIN=/{min=$2} END{print int(max-min)}')
		[ "${spread:-0}" -lt 24 ] || break
		[ $try -lt 3 ] || {
			echo "$step: окно Discord не поймано 3 раза, пустые кадры в $src" >&2
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
		ffmpeg -nostdin -v error -y -i "$tmp/card.mp4" -i "$tmp/body.mp4" -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" $enc "$take/$step-chat.mp4"
	else
		cp "$tmp/body.mp4" "$take/$step-chat.mp4"
	fi
	jq --arg s "$step" --arg f "$step-chat.mp4" --arg c "Discord, #$name" '
		def fix: if (.file | startswith($s + "-chat.")) then .file = $f | .caption = $c else . end;
		.plans[$s].clips |= map(fix) | .clips |= map(fix)' "$m" >"$tmp/m.json"
	cp "$tmp/m.json" "$m"
	echo "$step: окно Discord #$name, $secs с - $take/$step-chat.mp4"
done <"$tmp/steps"
