# Release Process

Marketplace releases currently use Microsoft Entra ID. GitHub OIDC publishing is
prepared but is not operational yet.

## Authentication status

See [Marketplace publishing status](./marketplace-publishing.md) for the dated
rollout status, current Entra procedure, and future OIDC migration checklist.

## Automated release

1. Update the version in `package.json` and `package-lock.json`.
2. Run `npm test` and `npm run package:vsix` locally.
3. Commit the release changes and push them to `main`.
4. Create and push a matching tag, such as `v0.2.7`.
5. Publish a GitHub Release for that tag and attach the VSIX.
6. Publish to the Marketplace using Microsoft Entra ID.

The future OIDC workflow is manual-only and must not be run until Marketplace
trusted publishing is available.

## Local release helper

The normal command publishes with Entra ID, packages, tags, and creates the
GitHub Release:

```bash
scripts/release.sh --publish-entra --tag --gh-release
```

Other useful commands:

- `npm run publish:vsix` publishes with Microsoft Entra ID.
- `npm run publish:vsix:entra` is the explicit alias for Entra publishing.
- `npm run publish:vsix:oidc` is reserved for the future trusted workflow.
- `scripts/release.sh --publish-entra` enables Marketplace publishing in the
  local release helper.
- Set `DOCKER_EXEC="docker exec -i <container>"` to run npm/npx inside a
  container.

Marketplace versions are immutable; never publish the same version through two
authentication routes.
