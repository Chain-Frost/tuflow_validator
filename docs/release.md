# Release process

Marketplace Trusted Publishing is available. This repository's manual OIDC
workflow is prepared, but the GitHub `production` environment and the publisher's
Marketplace policy must be configured and verified before a real release.

See [Marketplace publishing](./marketplace-publishing.md) for the dated status,
exact policy values, pinned build toolchain, approval requirements and evidence.
Only Path Validator's `Chain-Frost` Marketplace identity is in scope.

## Manual GitHub Actions release

Perform these steps only after the owner has approved a new release:

1. Update the extension version in `package.json` and `package-lock.json` in a
   reviewed change. Run the required Windows/Linux host and VSIX checks.
2. Merge the approved release source to `main` and record its full commit SHA.
3. Create the matching stable `vMAJOR.MINOR.PATCH` tag, protected against movement
   or deletion. Do not reuse an existing Marketplace version.
4. From `main`, manually dispatch **Publish to VS Code Marketplace (Trusted
   Publishing)** with the tag and reviewed commit SHA. Creating a GitHub Release
   alone does not trigger publication.
5. Review the verification job and approve the `production` deployment only when
   the exact source, tests and package are acceptable. The publishing job sends
   that verified artifact using OIDC; it does not rebuild or increment a version.
6. After the authorised publication succeeds, verify the Marketplace version and
   retain the run/package provenance. A GitHub Release can then reference the
   same tag and package according to the separately approved release plan.

Do not dispatch this workflow just to test authentication. No end-to-end OIDC
success is claimed until a separately authorised new-version publication has
completed. Never publish one version through both OIDC and Entra.

## Explicit local Entra alternative

The existing Entra scripts remain available for an independently approved local
release. Authenticate the intended Entra identity before running them:

```bash
az login
bash scripts/release.sh --publish-entra --tag --gh-release
```

That command has real external effects: it publishes, tags and creates a GitHub
Release. It is not an OIDC test or an automatic fallback.

Other commands:

- `npm run publish:vsix` and `npm run publish:vsix:entra` explicitly publish with
  Microsoft Entra ID.
- `npm run publish:vsix:oidc` is for the configured GitHub Trusted Publishing
  workflow; no provider/token context means failure, not an authentication fallback.
- `bash scripts/release.sh --publish-entra` enables Entra publishing in the local
  release helper. Its operational behaviour is unchanged by the OIDC preparation.
- `DOCKER_EXEC="docker exec -i <container>"` runs the helper's npm/npx commands
  inside a container; use the pinned `.nvmrc` build version there too.
