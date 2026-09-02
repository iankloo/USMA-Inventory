#!/usr/bin/env bash
# Deploy the current GitHub main branch to the one approved production instance.
#
# This script deliberately does not create Lightsail instances, snapshots, static
# IPs, or database backups. It updates the existing instance in place.

set -Eeuo pipefail

readonly AWS_PROFILE_NAME="${AWS_PROFILE:-kloo-personal}"
readonly AWS_REGION_NAME="${AWS_REGION:-us-east-1}"
readonly INSTANCE_NAME="${LIGHTSAIL_INSTANCE:-arms-inventory-recovery}"
readonly STATIC_IP_NAME="${LIGHTSAIL_STATIC_IP:-arms-inventory-ip}"
readonly EXPECTED_IP="${LIGHTSAIL_EXPECTED_IP:-34.202.96.191}"
readonly DEPLOY_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/arms-inventory-deploy}"
readonly DEPLOY_USER="${DEPLOY_SSH_USER:-ubuntu}"
readonly REPOSITORY_DIR="${PRODUCTION_REPOSITORY_DIR:-/opt/arms-inventory/app}"
readonly WEB_DIR="${PRODUCTION_WEB_DIR:-/opt/arms-inventory/web-dist}"
readonly PRODUCTION_URL="${PRODUCTION_URL:-https://arms.dse-apps.com}"

usage() {
  cat <<'EOF'
Usage: scripts/deploy-lightsail.sh --yes

Fetches GitHub main on the verified Lightsail production instance, builds the
API and web bundle in place, applies Prisma migrations, updates the served web
files, recreates only the API container, and verifies the public health endpoint.

It refuses to deploy if the production instance/static-IP checks fail or if
tracked files in the production checkout have uncommitted changes. Untracked
server configuration such as .env, Dockerfile, Caddyfile, and compose.yaml is
preserved.

Environment overrides are available for recovery only: AWS_PROFILE,
LIGHTSAIL_INSTANCE, LIGHTSAIL_STATIC_IP, LIGHTSAIL_EXPECTED_IP, DEPLOY_SSH_KEY,
DEPLOY_SSH_USER, PRODUCTION_REPOSITORY_DIR, PRODUCTION_WEB_DIR, and PRODUCTION_URL.
EOF
}

if [[ "${1:-}" != "--yes" || $# -ne 1 ]]; then
  usage >&2
  exit 2
fi

require_command() {
  command -v "$1" >/dev/null || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

for command_name in aws curl ssh; do
  require_command "$command_name"
done

if [[ ! -r "$DEPLOY_KEY" ]]; then
  echo "Deployment SSH key is not readable: $DEPLOY_KEY" >&2
  exit 1
fi

instance_state="$(aws --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" lightsail get-instances \
  --query "instances[?name=='$INSTANCE_NAME'] | [0].state.name" --output text)"
instance_ip="$(aws --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" lightsail get-instances \
  --query "instances[?name=='$INSTANCE_NAME'] | [0].publicIpAddress" --output text)"
static_ip="$(aws --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" lightsail get-static-ip \
  --static-ip-name "$STATIC_IP_NAME" --query 'staticIp.ipAddress' --output text)"
attached_instance="$(aws --profile "$AWS_PROFILE_NAME" --region "$AWS_REGION_NAME" lightsail get-static-ip \
  --static-ip-name "$STATIC_IP_NAME" --query 'staticIp.attachedTo' --output text)"

if [[ "$instance_state" != "running" || "$instance_ip" != "$EXPECTED_IP" || "$static_ip" != "$EXPECTED_IP" || "$attached_instance" != "$INSTANCE_NAME" ]]; then
  echo "Refusing deployment: Lightsail production identity check failed." >&2
  printf 'instance=%s state=%s ip=%s; static-ip=%s attached-to=%s\n' \
    "$INSTANCE_NAME" "$instance_state" "$instance_ip" "$static_ip" "$attached_instance" >&2
  exit 1
fi

curl --fail --silent --show-error "$PRODUCTION_URL/healthz" >/dev/null
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$DEPLOY_KEY" \
  "$DEPLOY_USER@$EXPECTED_IP" 'printf "Deployment SSH access verified\\n"'

ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i "$DEPLOY_KEY" \
  "$DEPLOY_USER@$EXPECTED_IP" bash -s -- "$REPOSITORY_DIR" "$WEB_DIR" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

repository_dir="$1"
web_dir="$2"

cd "$repository_dir"
sudo git fetch origin main

tracked_changes="$(sudo git status --porcelain --untracked-files=no)"
if [[ -n "$tracked_changes" ]]; then
  echo "Refusing deployment: tracked production files are dirty:" >&2
  printf '%s\n' "$tracked_changes" >&2
  exit 1
fi

current_commit="$(sudo git rev-parse HEAD)"
target_commit="$(sudo git rev-parse origin/main)"
if [[ "$current_commit" == "$target_commit" ]]; then
  echo "Production already has GitHub main: $current_commit"
  exit 0
fi

echo "Deploying $current_commit -> $target_commit"
sudo git reset --hard "$target_commit"

# Build first, while the currently running API remains available.
sudo docker compose build api

# The migration command is idempotent. It runs before the new API starts.
sudo docker compose run --rm api npm run db:migrate

# Extract the freshly built web bundle into a staging directory, then sync it
# into the known Caddy-served directory. Only stale build assets are removed.
stage_dir="$(sudo mktemp -d /tmp/arms-web-release.XXXXXX)"
container_id=""
cleanup() {
  local status=$?
  if [[ -n "$container_id" ]]; then
    sudo docker rm "$container_id" >/dev/null 2>&1 || true
  fi
  sudo rm -rf -- "$stage_dir"
  exit "$status"
}
trap cleanup EXIT

container_id="$(sudo docker create app-api:latest)"
sudo docker cp "$container_id":/app/apps/web/dist/. "$stage_dir"/
sudo docker rm "$container_id" >/dev/null
container_id=""
sudo rsync -a --delete --delay-updates "$stage_dir"/ "$web_dir"/

# Keep PostgreSQL and Caddy running; replace only the API service.
sudo docker compose up -d --no-deps --force-recreate --no-build api
sleep 5
sudo docker compose ps api
printf 'Deployed commit: '
sudo git rev-parse HEAD
REMOTE_SCRIPT

curl --fail --silent --show-error "$PRODUCTION_URL/healthz" >/dev/null
curl --fail --silent --show-error -o /dev/null -w 'Production HTTP %{http_code}\n' "$PRODUCTION_URL/"
echo "Deployment verified: $PRODUCTION_URL"
