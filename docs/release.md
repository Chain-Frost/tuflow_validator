# Release process

Marketplace Trusted Publishing was successfully exercised for `v0.2.7` in
[approved production run 45228773579](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45228773579).
The protected GitHub `production` environment and publisher policy are configured.
Following issue #36's approved integration, the same manual workflow will also
create the GitHub Release **only after the Marketplace publishing job succeeds**.
The already-published `v0.2.7` needs a one-time GitHub Release backfill; do not
re-run Marketplace publication for that historical version.

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
6. After the Marketplace publishing job succeeds, a **separate**
   `github_release` job obtains the exact verified VSIX and checksum artifact
   from that run, rechecks the protected tag object/source and checksum, then
   creates a GitHub Release for the existing tag. It attaches the versioned
   VSIX and `.sha256` file and renders final notes from
   `docs/releases/vMAJOR.MINOR.PATCH.md` (the reviewed
   `## Changes since published ...` section), omitting draft/status text.
   This job alone receives `contents: write`; it never requests OIDC,
   recompiles or publishes another Marketplace package.
7. Verify both the GitHub Release assets and the Marketplace-delivered
   version independently, and retain the provenance for installed-profile
   acceptance. A successful Marketplace command is not evidence of identical
   Marketplace-delivered bytes or of the user's normal installation.

Do not dispatch this workflow just to test authentication. The genuine `v0.2.7`
OIDC publication succeeded on 23 November 2026; do not repeat it as a GitHub
Release recovery mechanism. If the post-publish GitHub Release job fails,
investigate its logs and separately backfill the existing tag from the
preserved **same-run** VSIX and checksum under owner authorisation.
The release job refuses to overwrite an existing GitHub Release. Do not
publish a version through both OIDC and Entra.

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
