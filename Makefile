# Проверки съёмки: скрипты (shellcheck, shfmt), типы, стиль и тесты (в Docker - как в CI).
SCRIPTS := $(wildcard scripts/*.sh)
NODE := docker.io/library/node:24.21.0-bookworm
# Пользователь контейнеров, которые пишут в каталоги репозитория (scripts/host-user.sh).
HOST_USER := $(shell scripts/host-user.sh)

.PHONY: check test fmt

check:
	shellcheck -x -P . $(SCRIPTS)
	shfmt -d $(SCRIPTS)

test:
	docker run --rm -u "$(HOST_USER)" -e HOME=/tmp -v "$$PWD":/w -w /w $(NODE) \
		sh -c 'npm ci --no-audit --no-fund --silent && npx tsc --noEmit && npx biome ci && npm test'

fmt:
	docker run --rm -u "$(HOST_USER)" -e HOME=/tmp -v "$$PWD":/w -w /w $(NODE) \
		sh -c 'npm ci --no-audit --no-fund --silent && npx biome check --write'
