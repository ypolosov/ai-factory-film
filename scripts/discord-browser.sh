#!/bin/sh
# discord-browser.sh - окно Discord для записи через OBS (решение владельца 18.10, вариант браузера):
# Microsoft Edge на Windows в режиме приложения, с отдельным профилем и портом отладки. Своё окно:
# OBS ловит его по программе msedge.exe, и оно не смешивается с повседневным Chrome. Первый раз
# владелец сам входит в Discord в этом окне (учётка, которая видит сервер); дальше запись
# (scripts/demo-discord.sh) только переводит его по адресам сообщений дубля. Пароль скрипт не видит.
# Порт - CDP_PORT (по умолчанию 9223). Запуск из корня репозитория.
set -eu

port=${CDP_PORT:-9223}
if node scripts/cdp.mjs status 2>/dev/null; then
	exit 0
fi
# Запуск через PowerShell: cmd.exe /c start с такими кавычками из WSL зависает. Окно за другими окнами
# Edge перестаёт рисовать (учёт перекрытия окон) - OBS пишет серый пустой кадр: учёт перекрытия выключен.
# shellcheck disable=SC2016 # $env и обратные кавычки - для PowerShell
powershell.exe -NoProfile -Command 'Start-Process -FilePath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList ("--user-data-dir=`"" + $env:LOCALAPPDATA + "\ai-factory-film\discord-edge`"", "--remote-debugging-port='"$port"'", "--no-first-run", "--window-size=1280,760", "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--app=https://discord.com/app")' </dev/null
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
