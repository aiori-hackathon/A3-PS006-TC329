.PHONY: help install pki test demo up down dev clean verify-python

help:
	@echo "INTERLOCK PS-006 Build & Automation Commands"
	@echo "---------------------------------------------"
	@echo "  make install       Install all project dependencies"
	@echo "  make pki           Generate Lab Root CA and Replica X.509 certificates"
	@echo "  make test          Run full 58-test verification suite (policy, audit, scoring, security)"
	@echo "  make demo          Execute automated scenario demonstration"
	@echo "  make dev           Start local dev server and realtime bridge"
	@echo "  make up            Launch Docker Compose container environment"
	@echo "  make down          Stop and remove Docker Compose containers"
	@echo "  make verify-python Run independent Python audit chain and policy evaluators"
	@echo "  make clean         Clean build artifacts and temporary files"

install:
	npm install
	npx prisma generate

pki:
	node scripts/generate-pki.mjs

test: pki
	node --experimental-strip-types --loader ./scripts/test-loader.mjs --test tests/*.test.ts

demo: pki
	@echo "=== Starting Automated PS-006 Scenario Demo ==="
	node --experimental-strip-types --loader ./scripts/test-loader.mjs --test tests/policy.test.ts tests/scoring.test.ts
	@echo "=== Determinism & Policy Invariants Verified ==="

verify-python:
	python scripts/evaluate_policy.py
	python scripts/verify_audit.py

dev: pki
	npm run dev

up: pki
	docker compose up -d --build

down:
	docker compose down

clean:
	rm -rf .next dev.log server.log
