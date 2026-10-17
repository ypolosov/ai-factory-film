# ai-factory-film

Съёмка видео-демо фабрики ПО на ИИ ([ai-factory](https://github.com/ypolosov/ai-factory)): ИИ-персонажи играют команду, режиссёр ведёт их по сценарию, камера снимает экраны, из журнала дубля собирается ролик.

Съёмка - отдельная система. Она не берёт ключей фабрики, не импортирует её код и не знает её внутренностей. О фабрике съёмка знает только её видимые выходы: метки задач, статусы коммитов, ответы и объявления бота. Перечень этих выходов фабрика ведёт у себя (`docs/demo/visible-outputs.md` в ai-factory) и проверяет своим контрактным тестом; здесь он - [src/contract.ts](src/contract.ts).

## Как устроено

- [film/film.yml](film/film.yml) - сценарий съёмки: участники, шаги, итоги шагов, кадры. Заготовки PR и вложений - [film/film-assets/](film/film-assets/), аватарки персонажей - [film/avatars/](film/avatars/).
- [src/film.ts](src/film.ts) - режиссёр и камера (Playwright без окна).
  - Участник шага действует своей учёткой: бот Discord, Atlassian, приложение GitHub.
  - Итог шага ждётся по связи с объектом дубля, а не по фразе фабрики: ответ на сообщение шага, ключ задачи и её связи, номер PR и статус на нужном коммите, тег.
  - Сбой команды, метка провала агента, красный статус там, где нужен зелёный, - провал шага сразу, с причиной.
  - Журнал дубля (`manifest.json`) пишется после каждого шага; прерванный дубль продолжается с последнего сделанного шага.
  - Мир дубля свой: всё, что дубль создаёт или видит (задачи, страницы, PR), получает метки `film` и имени дубля; ожидание, выбравшее объект другого дубля, - провал шага. Ключ дубля `{takeKey}` делает объект дубля своим там, где площадка склеивает похожие (сбой в GlitchTip).
  - Новый дубль начинается с проверки готовности мира, только чтением: стенд выложен с вершины main, нет открытых PR и задач прошлых дублей, нет нерешённых сбоев стенда, входы камеры действуют и принадлежат своим персонажам.
- [src/script.ts](src/script.ts) - сценарий и проверка его цельности до первого действия: участники и учётки, подстановки, видимые выходы, учётки камеры.
- [src/atlassian.ts](src/atlassian.ts), [src/discord.ts](src/discord.ts), [src/github.ts](src/github.ts) - тонкие клиенты площадок учётками съёмки. Повторяется только чтение и повторяемая правка; уже сделанное второй раз не делается.

## Учётки и состояние

Всё секретное - в `.state/` (git его не видит):

- `discord-<персонаж>.env` - боты персонажей ([scripts/persona-bot-add.sh](scripts/persona-bot-add.sh));
- `discord-camera.env` - бот камеры с правом читать содержимое сообщений ([scripts/camera-bot-add.sh](scripts/camera-bot-add.sh));
- `atlassian-<персонаж>.env` - учётки Atlassian персонажей ([scripts/persona-atlassian-add.sh](scripts/persona-atlassian-add.sh));
- `github-app-<персонаж>.env` и `.pem` - приложения GitHub персонажей ([scripts/persona-github-app-add.sh](scripts/persona-github-app-add.sh));
- `discord-webhook-<канал>.env` - вебхук самозванца ([scripts/film-webhook-add.sh](scripts/film-webhook-add.sh));
- `camera/*.json` - входы камеры под персонажами и на сайтах ([scripts/camera-login.sh](scripts/camera-login.sh));
- `glitchtip.token` - ключ сброса для сбоев стенда, по желанию;
- `world.env` - мир съёмки: `ATLASSIAN_SITE`, `JIRA_PROJECT`, `CONFLUENCE_SPACE`, `GITHUB_TARGET_REPO`, по желанию;
- `films/<время>/` - клипы и журналы дублей.

Камера смотрит учётками из `camera` в сценарии: свой бот в Discord, учётки персонажей в Jira, Confluence и GitHub.

## Запуск

```sh
scripts/demo-reset.sh -n        # что сброс сделает перед дублем
docker run ... ai-factory-film/camera /film/film.yml /out --preflight   # только проверка готовности мира
scripts/demo-film.sh            # сброс и дубль целиком
scripts/demo-film.sh --ctx .state/films/<время>/manifest.json   # продолжить прерванный дубль
scripts/demo-cut.sh .state/films/<время>                        # черновая склейка
```

Фабрика и стенд цели должны уже работать: их поднимает ai-factory.

## Проверки

`make check` - скрипты (shellcheck, shfmt), `make test` - типы, стиль (Biome) и тесты (Vitest) в Docker, как в CI. Тест границы не пускает в код и скрипты съёмки ключи и код фабрики.

Лицензия - Apache-2.0.
