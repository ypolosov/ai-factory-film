#!/bin/sh
# discord-browser.sh - окно Discord для записи переписки дубля (scripts/demo-discord.sh): Chrome в режиме
# приложения с отдельным профилем и портом отладки - не смешивается с повседневным Chrome. Первый раз
# владелец сам входит в Discord в этом окне (учётка, которая видит сервер); дальше запись только
# переводит его по адресам сообщений дубля. Пароль скрипт не видит.
# Порт - CDP_PORT (по умолчанию 9223), профиль - DISCORD_PROFILE (по умолчанию .state/discord-chrome:
# в профиле вход в Discord, а куки съёмки живут только в .state). Запуск из корня репозитория.
set -eu

port=${CDP_PORT:-9223}
profile=${DISCORD_PROFILE:-$PWD/.state/discord-chrome}
if node scripts/cdp.mjs status 2>/dev/null; then
	exit 0
fi
mkdir -p "$profile"
chmod 700 "$profile"
# Окно за другими окнами браузер перестаёт рисовать - в записи были бы пустые кадры: торможение
# фоновых и перекрытых окон выключено.
nohup google-chrome --user-data-dir="$profile" --remote-debugging-port="$port" --remote-debugging-address=127.0.0.1 \
	--no-first-run --no-default-browser-check --window-size=1280,760 --disable-backgrounding-occluded-windows \
	--disable-renderer-backgrounding --disable-background-timer-throttling --app=https://discord.com/app >/dev/null 2>&1 &
i=0
until node scripts/cdp.mjs status 2>/dev/null; do
	i=$((i + 1))
	[ $i -le 30 ] || {
		echo "окно Discord не открылось за 30 с (порт $port)" >&2
		exit 1
	}
	sleep 1
done
echo "окно Discord открыто; первый раз войдите в нём в Discord и откройте сервер стенда"
