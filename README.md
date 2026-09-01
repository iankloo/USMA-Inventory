# USMA Inventory

Production deployment and recovery instructions are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

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
