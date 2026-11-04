.PHONY: install run

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
VENV := $(ROOT)/backend/.venv
PY := $(VENV)/bin/python

install:
	python3 -m venv $(VENV)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r $(ROOT)/backend/requirements.txt
	npm install --prefix $(ROOT)/frontend

run:
	@test -x "$(PY)" || { echo "Run make install first."; exit 1; }
	@test -d "$(ROOT)/frontend/node_modules" || { echo "Run make install first."; exit 1; }
	@test -f "$(ROOT)/.env" || { echo "Missing .env. Copy .env.example to .env and fill it in."; exit 1; }
	@bash -c 'set -a; source "$(ROOT)/.env"; set +a; \
	  set -m; \
	  echo "Backend  http://$${BACKEND_HOST:-127.0.0.1}:$${BACKEND_PORT:-8000}"; \
	  echo "Frontend $${FRONTEND_ORIGIN:-http://localhost:3000}"; \
	  echo "Ctrl+C stops both."; \
	  ( cd "$(ROOT)/backend" && "$(PY)" -m uvicorn app.main:app --reload --host "$${BACKEND_HOST:-127.0.0.1}" --port "$${BACKEND_PORT:-8000}" ) & \
	  bp=$$!; \
	  npm --prefix "$(ROOT)/frontend" run dev & \
	  fp=$$!; \
	  trap "kill -- -$$bp -$$fp 2>/dev/null; exit 0" INT TERM; \
	  while kill -0 $$bp 2>/dev/null && kill -0 $$fp 2>/dev/null; do sleep 1; done; \
	  kill -- -$$bp -$$fp 2>/dev/null; \
	  wait'
