#!/usr/bin/env bash
# One-command deploy to a Nobus VM (Ubuntu, ports 80/443 open), run from a laptop:
#   deploy/nobus.sh ubuntu@<public-ip> [domain]     (domain defaults to <ip-with-dashes>.sslip.io)
# Needs: SSH access, ~/.zend/kobolt/secrets.env (from `zend apps create` + `resolver-key`), LLM_API_KEY or GEMINI_API_KEY.
set -euo pipefail
HOST="${1:?usage: deploy/nobus.sh user@ip [domain]}"
IP="${HOST#*@}"
DOMAIN="${2:-${IP//./-}.sslip.io}"
ORIGIN="https://$DOMAIN"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HOME/.zend/kobolt/secrets.env"
BOT="${BOT-kobolt}"   # @kobolt, from `zend bot create`; BOT= to deploy without it
BOT_FILE="$HOME/.zend/bots/$BOT.json"
BOT_API_KEY=""; BOT_PRIVATE_KEY=""
if [ -n "$BOT" ] && [ -f "$BOT_FILE" ]; then
  BOT_API_KEY="$(node -p "require('$BOT_FILE').apiKey")"
  BOT_PRIVATE_KEY="$(node -p "require('$BOT_FILE').privateKey")"
fi
KEY="${SSH_KEY:-$HOME/.ssh/kobolt_nobus_rsa}"
ssh() { command ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$@"; }
scp() { command scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$@"; }
cd "$ROOT"

# 1. .env (kept on the VM across redeploys; never committed)
if ! ssh "$HOST" test -f kobolt/.env; then
  umask 077
  set -a; . "$SECRETS"; set +a
  LLM="${LLM_API_KEY:-${GEMINI_API_KEY:?set LLM_API_KEY or GEMINI_API_KEY}}"
  PGPW="$(openssl rand -hex 16)"
  cat > /tmp/kobolt.env <<EOF
PUBLIC_ORIGIN=$ORIGIN
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$PGPW
SESSION_SECRET=$(openssl rand -hex 32)
OPS_TOKEN=$(openssl rand -hex 12)
ZEND_API=https://api.usezend.app
ZEND_APP_SLUG=kobolt
ZEND_APP_KEY=$ZEND_APP_KEY
ZEND_WEBHOOK_SECRET=$ZEND_WEBHOOK_SECRET
ZEND_RESOLVER_SEED=$ZEND_RESOLVER_SEED
ZEND_BOT_API_KEY=$BOT_API_KEY
ZEND_BOT_PRIVATE_KEY=$BOT_PRIVATE_KEY
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=$LLM
LLM_MODEL=gemini-flash-lite-latest
LLM_FALLBACK_MODELS=gemini-3.5-flash-lite,gemini-flash-latest
CHECK_SAMPLES=3
FX_URL=https://open.er-api.com/v6/latest/USD
DEMO_MODE=1
EOF
  ssh "$HOST" "mkdir -p kobolt && chmod 700 kobolt"
  scp -q /tmp/kobolt.env "$HOST:kobolt/.env"
  rm -f /tmp/kobolt.env
  ssh "$HOST" "chmod 600 kobolt/.env"
fi

# 2. Code
tar --exclude=node_modules --exclude=web/dist --exclude=.git --exclude=.env --exclude=backups --exclude="*.pem" --exclude="*.key" -czf - . | ssh "$HOST" "cd kobolt && tar xzf -"

# 3. Docker + start
ssh "$HOST" 'set -e
  # Small instances: 2 GB of swap so the one-time image build never runs out of memory.
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
    echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  fi
  command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sudo sh)
  cd kobolt
  sudo docker compose -f deploy/compose.yml --env-file .env --profile bot up -d --build
  sudo docker compose -f deploy/compose.yml --env-file .env ps'

# 4. Wait for HTTPS
echo "Waiting for $ORIGIN ..."
for i in $(seq 1 40); do curl -fsS "$ORIGIN/livez" >/dev/null 2>&1 && break; sleep 5; done
curl -sS "$ORIGIN/healthz"; echo

# 5. Point Zend at it
node deploy/manifest.mjs "$ORIGIN" "$(cat "$HOME/.zend/kobolt/resolver.pub")" ${BOT:+$BOT}
zend apps check zapp.json && zend apps deploy zapp.json
echo "Ops page: $ORIGIN/ops?token=$(ssh "$HOST" "grep ^OPS_TOKEN kobolt/.env | cut -d= -f2")"
