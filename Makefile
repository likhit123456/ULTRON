# ULTRON dashboard — build + deploy to Pi4
#
# Usage:
#   make wheelhouse                          # download aarch64 wheels for air-gapped Pi
#   make deploy PI=ultron@192.168.50.1       # rsync to Pi (never deploys ca/)
#
# ca/ is NEVER deployed. The target aborts if ca/ or ca.key exist in the tree.
# certs/server.key IS deployed (mode 0600, owned by the service user).

PI         ?= ultron@192.168.50.1
SVC_USER   ?= ultron
DEST       ?= /opt/ultron/dashboard
PY_VERSION ?= 3.11
PLATFORM   ?= manylinux2014_aarch64

.PHONY: wheelhouse deploy deploy-check deploy-setup

# ── Wheelhouse (run on dev machine, ships to Pi offline) ────────────────────
wheelhouse:
	pip download \
		--dest wheelhouse/ \
		--platform $(PLATFORM) \
		--python-version $(PY_VERSION) \
		--only-binary=:all: \
		-r dashboard/server/requirements.txt
	@echo ""
	@echo "Wheelhouse ready. Copy wheelhouse/ to the Pi and install with:"
	@echo "  pip install --no-index --find-links wheelhouse/ -r server/requirements.txt"

# ── Deploy checks ───────────────────────────────────────────────────────────
deploy-check:
	@if [ -d ca ] || [ -f ca/ca.key ]; then \
		echo "ABORT: ca/ directory or ca.key exists in the repo tree."; \
		echo "Move ca/ to the admin SSD before deploying."; \
		echo "ca.key must NEVER be on the Pi."; \
		exit 1; \
	fi

# ── First-time Pi setup (run once) ─────────────────────────────────────────
deploy-setup:
	ssh $(PI) '\
		sudo useradd -r -s /usr/sbin/nologin $(SVC_USER) 2>/dev/null || true; \
		sudo mkdir -p /var/lib/ultron $(DEST)/certs; \
		sudo chown $(SVC_USER):$(SVC_USER) /var/lib/ultron; \
		sudo chmod 700 /var/lib/ultron'
	@echo "Pi setup complete. Run 'make deploy' next."

# ── Deploy ──────────────────────────────────────────────────────────────────
deploy: deploy-check
	rsync -avz --delete \
		--exclude='ca/' \
		--exclude='ca.key' \
		--exclude='.git/' \
		--exclude='node_modules/' \
		--exclude='__pycache__/' \
		--exclude='.venv/' \
		--exclude='venv/' \
		--exclude='auth.db*' \
		--exclude='dashboard/web/src/' \
		--exclude='dashboard/web/node_modules/' \
		./ $(PI):$(DEST)/
	ssh $(PI) '\
		chmod 600 $(DEST)/certs/server.key; \
		chown $(SVC_USER):$(SVC_USER) $(DEST)/certs/server.key; \
		if [ ! -f /var/lib/ultron/auth.db ]; then \
			touch /var/lib/ultron/auth.db; \
			chown $(SVC_USER):$(SVC_USER) /var/lib/ultron/auth.db; \
			chmod 600 /var/lib/ultron/auth.db; \
		fi'
	@echo ""
	@echo "Deploy complete."
	@echo "  certs/server.key → mode 0600, owned by $(SVC_USER)"
	@echo "  auth.db → /var/lib/ultron/auth.db (0600)"
	@echo "  ca/ excluded."
	@echo ""
	@echo "Install venv on Pi (first time):"
	@echo "  ssh $(PI) 'python3 -m venv $(DEST)/venv && $(DEST)/venv/bin/pip install --no-index --find-links $(DEST)/wheelhouse/ -r $(DEST)/dashboard/server/requirements.txt'"
