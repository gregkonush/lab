.PHONY: migrate-up migrate-down create-migration start-workflow start-worker

# Default DATABASE_URL if not set externally
DATABASE_URL ?= postgres://prix:prix@localhost:5432/prix?sslmode=disable

# Temporal settings
TEMPORAL_TASK_QUEUE := prix

MIGRATIONS_PATH := db/migrations

# Check if migrate tool is installed, if not, suggest installation
check-migrate:
ifeq ($(shell command -v migrate 2> /dev/null),)
	$(error "migrate CLI not found. Install: https://github.com/golang-migrate/migrate/releases")
endif

MIGRATE = migrate

# Check if tctl tool is installed, if not, suggest installation
ifeq ($(shell command -v tctl 2> /dev/null),)
TCTL = $(error "tctl command not found. See Temporal docs for installation: https://docs.temporal.io/cli")
else
TCTL = tctl
endif

migrate-up:
	@echo "Applying migrations..."
	@$(MIGRATE) -database "$(DATABASE_URL)" -path $(MIGRATIONS_PATH) up

migrate-down:
	@echo "Rolling back last migration..."
	@$(MIGRATE) -database "$(DATABASE_URL)" -path $(MIGRATIONS_PATH) down 1

# Example: make create-migration NAME=add_new_feature
create-migration:
	@if [ -z "$(NAME)" ]; then echo "Error: NAME variable is required. Usage: make create-migration NAME=<migration_name>"; exit 1; fi
	@echo "Creating migration: $(NAME)"
	@$(MIGRATE) create -ext sql -dir $(MIGRATIONS_PATH) -seq $(NAME)

# Example: make start-workflow NAME=ListRepos
start-workflow:
	@if [ -z "$(NAME)" ]; then echo "Error: NAME variable is required. Usage: make start-workflow NAME=<WorkflowName>"; exit 1; fi
	@echo "Starting workflow $(NAME) on task queue $(TEMPORAL_TASK_QUEUE)..."
	@$(TCTL) --namespace default workflow start \
		--taskqueue $(TEMPORAL_TASK_QUEUE) \
		--workflow_type $(NAME) \
		--workflow_id "$(NAME)-$(shell date +%s)" \
		--input '{}'

start-worker:
	@echo "Starting Temporal worker..."
	@go run ./worker/main.go
