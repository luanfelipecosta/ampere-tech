.PHONY: dev up down logs rebuild

# Local development — watches backend/src for changes and auto-rebuilds
dev:
	docker compose watch

# Start all services, always rebuilding images first (use for production deploys too)
up:
	docker compose up --build -d

# Stop and remove containers
down:
	docker compose down

# Tail logs for all services
logs:
	docker compose logs -f

# Force rebuild a single service without restarting others: make rebuild svc=backend
rebuild:
	docker compose build $(svc) && docker compose up -d --no-deps $(svc)
