# Production deployment runbook

This is the operational source of truth for the USMA Inventory production deployment. It intentionally contains no passwords, private keys, tokens, or database credentials.

## Current production

| Item | Value |
| --- | --- |
| Public URL | `https://arms.dse-apps.com` |
| AWS CLI profile | `kloo-personal` |
| AWS Region | `us-east-1` |
| Lightsail instance | `arms-inventory-recovery` |
| Static IP | `arms-inventory-ip` (`34.202.96.191`) |
| Health endpoint | `https://arms.dse-apps.com/healthz` |
| GitHub repository | `https://github.com/iankloo/USMA-Inventory` |
| Deployment checkout | `/opt/arms-inventory/app` |
| Served web files | `/opt/arms-inventory/web-dist` |

The instance name includes `recovery` because it replaced the original server during the September 2026 login incident. It is the only production instance; do not create another instance merely because of its name.

## AWS access

Use the personal AWS profile, not the default profile:

```sh
aws --profile kloo-personal lightsail get-instances
aws --profile kloo-personal lightsail get-static-ip --static-ip-name arms-inventory-ip
```

If the CLI reports that its session has expired, reauthenticate before making any change. Do not fall back to another AWS profile or account.

Before a destructive action, verify all three facts:

1. `arms.dse-apps.com/healthz` is healthy.
2. `arms-inventory-ip` is attached to the intended production instance.
3. The target name is exactly the one intended for the action.

## Access is a deployment prerequisite

Never remove an SSH key, snapshot, instance, static IP, or other recovery artifact until **two independently tested access paths** exist. A successful login from the same shell is not two paths.

Required access design for any replacement instance:

1. A user-controlled administrative SSH key.
2. A dedicated deployment SSH key.
3. Each private key stored in a durable user-controlled secret store, never in the repository, chat, or `/tmp`.
4. Each key tested from a separate session before traffic moves.
5. Key fingerprints and credential owners recorded in a private operations record, not in this file.

Do not create a replacement instance, snapshot, or temporary clone without explicit user approval and a written cleanup plan. Delete temporary resources only after production health and both access paths have been rechecked.

## Deploying `main`

The desired revision is the current GitHub `main` branch. A normal deployment must happen in place on the production instance; it must not require a second Lightsail instance.

Preflight:

```sh
git fetch origin main
git rev-parse origin/main
curl --fail --silent --show-error https://arms.dse-apps.com/healthz
```

After connecting through both verified SSH access paths:

```sh
cd /opt/arms-inventory/app
git fetch origin main
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

Do not overwrite a dirty checkout until its changes have been explained. The production environment has deployment-specific untracked files such as `.env`, `compose.yaml`, `Caddyfile`, and `Dockerfile`; preserve them.

Once the checkout is clean and access is verified, update only tracked source to `origin/main`, build the application with Docker Compose, and release the web bundle to `/opt/arms-inventory/web-dist`. Then verify:

```sh
curl --fail --silent --show-error https://arms.dse-apps.com/healthz
curl --fail --silent --show-error https://arms.dse-apps.com/
```

Record the deployed Git commit, build result, and health-check result in the deployment handoff. Do not claim a deploy succeeded based solely on `git pull`.

## Runtime layout

Docker Compose runs PostgreSQL, the API, and Caddy. Caddy serves the built web application from `/opt/arms-inventory/web-dist` and proxies `/api` to the API container. The API database is local to the Lightsail instance.

Because database data is local, a replacement-instance cutover can lose writes made after its snapshot. Treat a clone-and-IP-swap as a recovery operation, not a routine deployment technique.

## Cognito configuration

The production Cognito resources are in `us-east-1` under `kloo-personal`:

| Item | Value |
| --- | --- |
| User pool | `us-east-1_y2aviR7LN` |
| App client | `arms-inventory-web` (`2h3pohqgrursv7a6ioqjlu8cg3`) |
| Hosted UI domain | `arms-inventory-985236993383.auth.us-east-1.amazoncognito.com` |

The app client must retain these OAuth settings:

- Authorization Code flow enabled.
- `openid` and `email` scopes.
- Callback and logout URLs include both `https://arms.dse-apps.com` and `https://arms.dse-apps.com/`.

`aws cognito-idp update-user-pool-client` can clear omitted OAuth fields. Do not issue a partial update. First read the full client configuration, then make one explicit update that preserves every intended setting, and verify it with `describe-user-pool-client`.

## Cost and cleanup rules

- There must normally be one running Lightsail instance.
- Snapshots, clones, and temporary keys require explicit approval.
- Every approved temporary resource gets a named owner, purpose, and cleanup check before it is created.
- After deleting anything, report exactly what was removed and whether it is recoverable.

## Current access limitation

The original one-off SSH key for the current production instance was removed before a durable replacement access path was established. Do not attempt to solve that by silently creating a clone. First establish an approved recovery plan that includes the two-key design above, then document the resulting access fingerprints in the private operations record.
