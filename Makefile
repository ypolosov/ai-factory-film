# Проверки съёмки: скрипты (shellcheck, shfmt), типы, стиль и тесты (в Docker - как в CI).
SCRIPTS := $(wildcard scripts/*.sh)
NODE := docker.io/library/node:24.21.0-bookworm

.PHONY: check test fmt

check:
	shellcheck -x -P . $(SCRIPTS)
	shfmt -d $(SCRIPTS)

test:
	docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$$PWD":/w -w /w $(NODE) \
		sh -c 'npm ci --no-audit --no-fund --silent && npx tsc --noEmit && npx biome ci && npm test'

fmt:
	docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$$PWD":/w -w /w $(NODE) \
		sh -c 'npm ci --no-audit --no-fund --silent && npx biome check --write'
