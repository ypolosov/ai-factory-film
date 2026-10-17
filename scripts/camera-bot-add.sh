#!/bin/sh
# camera-bot-add.sh - мастер для человека: бот камеры в Discord. Камера читает ответы и объявления
# фабрики своей учёткой, а не токеном бота фабрики: съёмка - отдельная система. Читать чужие
# сообщения боту нужно намерение Message Content (у ботов персонажей его нет). Учётку бота создаёт
# только человек на портале разработчиков Discord; мастер ведёт по шагам, сохраняет токен в
# .state/discord-camera.env (ввод скрыт, в аргументы и журнал не попадает) и даёт ссылку
# приглашения только с правом читать каналы. В реестр ролей цели бот камеры не вносится: решений
# он не принимает и ничего не пишет.
# Пример: scripts/camera-bot-add.sh
set -eu

env=.state/discord-camera.env
api=https://discord.com/api/v10

cat <<EOF
Бот камеры:
1. Откройте https://discord.com/developers/applications -> New Application -> имя "Camera".
2. Бот приватный: раздел Installation -> Install Link: None, затем раздел Bot -> Public Bot
   выключить.
3. Раздел Bot -> Privileged Gateway Intents -> включить Message Content Intent (камера читает
   текст ответов фабрики) -> Save Changes.
4. Раздел Bot -> Reset Token -> скопируйте токен (он показывается один раз).
EOF
if [ -f "$env" ]; then
	echo "Токен уже сохранён в $env - шаги 1-4 пропустите, Enter - оставить его."
fi
printf '5. Вставьте токен (ввод скрыт): '
stty -echo 2>/dev/null || true
read -r token </dev/tty
stty echo 2>/dev/null || true
echo
if [ -n "$token" ]; then
	umask 077
	mkdir -p .state
	printf 'DISCORD_BOT_TOKEN=%s\n' "$token" >"$env"
	echo "сохранено: $env"
fi
[ -f "$env" ] || {
	echo "токена нет - бот камеры не заведён" >&2
	exit 2
}

hdr=$(mktemp)
trap 'rm -f "$hdr"' EXIT
chmod 600 "$hdr"
(
	# shellcheck disable=SC1090
	. "./$env"
	[ -n "${DISCORD_BOT_TOKEN:-}" ] || {
		echo "нет DISCORD_BOT_TOKEN в $env" >&2
		exit 2
	}
	printf 'Authorization: Bot %s\n' "$DISCORD_BOT_TOKEN"
) >"$hdr"
me=$(curl -fsS -H @"$hdr" "$api/users/@me") || {
	echo "Discord не принял токен - проверьте его и запустите мастер снова" >&2
	exit 2
}
id=$(printf '%s' "$me" | jq -r .id)
# Права бота камеры на сервере: только видеть каналы и читать историю (1024 + 65536).
cat <<EOF
6. Пригласите бота камеры на сервер фабрики (откроется выбор сервера):
   https://discord.com/oauth2/authorize?client_id=$id&scope=bot&permissions=66560
7. Проверка: режиссёр съёмки при запуске проверяет, что бот камеры ровно на одном сервере.
EOF
