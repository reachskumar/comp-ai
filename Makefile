.PHONY: dev build test lint format docker-build docker-up docker-down seed clean migrate

dev:
	docker compose up -d postgres redis
	pnpm dev

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint

format:
	pnpm format

docker-build:
	docker build -f apps/api/Dockerfile -t compport-api .
	docker build -f apps/web/Dockerfile -t compport-web .

docker-up:
	docker compose -f docker-compose.prod.yml up -d

docker-down:
	docker compose -f docker-compose.prod.yml down

seed:
	pnpm db:migrate && pnpm db:seed

migrate:
	pnpm db:migrate

clean:
	rm -rf apps/api/dist apps/web/.next packages/*/dist node_modules/.cache
