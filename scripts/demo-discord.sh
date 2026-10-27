#!/bin/sh
# demo-discord.sh КАТАЛОГ_ДУБЛЯ - запись окна Discord по журналу дубля (решение владельца 27.10, РП 60:
# запись вкладки по протоколу отладки браузера вместо OBS): для каждого шага с перепиской скрипт
# переводит окно Discord в браузере (scripts/discord-browser.sh) по адресу первого сообщения шага
# (id - в журнале, ctx.<шаг>.discord) и пишет вкладку (scripts/cdp.mjs record); запись встаёт в
# журнал вместо клипа чата - <шаг>-chat.mp4 (с карточкой главы, если клип чата начинал главу).
# От учётки владельца ничего не пишется; переходы запускает скрипт.
# Нужно окно Discord (scripts/discord-browser.sh, вход сделан). Запуск из корня репозитория; нужны
# node (22+), jq и ffmpeg.
set -eu

take=${1:?использование: demo-discord.sh КАТАЛОГ_ДУБЛЯ}
take=${take%/}
m=$take/manifest.json
[ -s "$m" ] || {
	echo "нет $m - это не каталог дубля" >&2
	exit 2
}
node scripts/cdp.mjs status </dev/null
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
		node scripts/cdp.mjs open "https://discord.com/channels/$guild/$ch/$msg" </dev/null >/dev/null
		# Discord подсвечивает сообщение после перехода - запись начинается, когда подсветка видна.
		sleep 2
		rm -rf "$tmp/rec"
		node scripts/cdp.mjs record "$secs" "$tmp/rec" </dev/null >/dev/null
		# Кадры страницы - в пикселях экрана (масштаб 2): после вписывания в 1280x720 пиксели перестают
		# быть квадратными, а склейка с карточкой главы требует одинаковых - setsar=1.
		# shellcheck disable=SC2086 # параметры кодека - через пробел
		ffmpeg -nostdin -v error -y -f concat -safe 0 -i "$tmp/rec/frames.txt" \
			-vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x1E1F24,setsar=1,fps=30" $enc "$tmp/body.mp4"
		# Пустой кадр - ровный (Discord не дорисовал страницу): переснять шаг. Кадр середины записи
		# без краёв: разброс яркости меньше 24 - пусто.
		spread=$(ffmpeg -nostdin -ss "$((secs / 2))" -i "$tmp/body.mp4" -frames:v 1 -vf "crop=iw*0.8:ih*0.8,signalstats,metadata=print:file=-" -f null - 2>/dev/null |
			awk -F= '/YMAX=/{max=$2} /YMIN=/{min=$2} END{print int(max-min)}')
		[ "${spread:-0}" -lt 24 ] || break
		[ $try -lt 3 ] || {
			echo "$step: окно Discord пусто 3 раза" >&2
			exit 1
		}
		try=$((try + 1))
	done
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
