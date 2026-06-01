.PHONY: help up down logs ps backend frontend migrate ngrok

help:
	@echo "VLIQ dev commands:"
	@echo "  make up        — поднять postgres + redis в docker"
	@echo "  make down      — погасить контейнеры"
	@echo "  make migrate   — alembic upgrade head (backend)"
	@echo "  make backend   — uvicorn dev-сервер (backend, порт 8000)"
	@echo "  make frontend  — vite dev-сервер (frontend, порт 5173)"
	@echo "  make ngrok     — открыть HTTPS-туннель на фронт для TMA"

up:
	docker compose up -d
	@docker compose ps

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

migrate:
	cd backend && \
	  JWT_SECRET_SALT=dev-only-not-for-prod \
	  TG_BOT_TOKEN=dummy \
	  POSTGRES__POSTGRES_URL=postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq \
	  poetry run alembic -c migrations/alembic.ini upgrade head

backend:
	cd backend && \
	  JWT_SECRET_SALT=dev-only-not-for-prod \
	  TG_BOT_TOKEN=dummy \
	  POSTGRES__POSTGRES_URL=postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq \
	  CORS_ORIGINS='["http://localhost:5173","https://*.ngrok-free.app"]' \
	  poetry run uvicorn src.app.main:app --reload --host 0.0.0.0 --port 8000

frontend:
	cd frontend && npm run dev

ngrok:
	@echo "Запускаю ngrok на :5173 (фронт). Скопируй HTTPS-URL → BotFather → /setdomain"
	ngrok http 5173
