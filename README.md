# USMA Inventory

Production deployment and recovery instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Deploying production

To deploy the newest GitHub `main` revision to the existing Lightsail instance,
run this from the repository root:

```sh
scripts/deploy-lightsail.sh --yes
```

The script verifies the AWS account's instance and static IP, confirms public
health and SSH access, refuses a dirty tracked production checkout, preserves
the server-only configuration, and then builds/releases in place. It never
creates an instance, snapshot, or other AWS resource. See
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for recovery and credential rules.

The server records the commit only after its rebuilt API has started and passed
a local health check. That means a later run retries safely if a previous
build was interrupted. Its build is also detached from the SSH session, so a
closed terminal does not leave the release half-built. It uses Docker's legacy
builder on Lightsail because that server's BuildKit export has intermittently
stalled.

## Production access

- Production URL: `https://arms.dse-apps.com`
- AWS profile: `kloo-personal`
- Lightsail instance: `arms-inventory-recovery`
- Static IP: `arms-inventory-ip` (`34.202.96.191`)

Two persistent SSH keys were created and independently tested on September 1,
2026. Their private material is intentionally not in this repository:

| Purpose | Local private-key path |
| --- | --- |
| Administrative access | `/Users/kloo/.ssh/arms-inventory-admin` |
| Deployment access | `/Users/kloo/.ssh/arms-inventory-deploy` |

Those keys currently exist only on this Mac with owner-only file permissions;
they are not backed up elsewhere. Do not delete either key until a tested
replacement and the Lightsail browser-SSH recovery route are available.
