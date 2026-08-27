# Marketplace Publishing Status

> Status recorded on 27 August 2026. Recheck the linked Microsoft issue before changing authentication.

## Decision

This project does not use a Visual Studio Marketplace Personal Access Token
(PAT), including as a temporary CI credential.

- Current authentication: Microsoft Entra ID.
- Future authentication: GitHub Actions OIDC trusted publishing.

## Why OIDC is not enabled yet

`@vscode/vsce` 3.9.2 contains the client-side `--oidc` command and documents
trusted publishing. The Visual Studio Marketplace does not yet expose the
trusted-publisher policy required to authorize a GitHub workflow identity.

Microsoft is tracking the remaining rollout in `microsoft/vscode-vsce#1275`.
On 10 August 2026, a Microsoft contributor said it should be available soon,
possibly around September:

- Tracking issue: https://github.com/microsoft/vscode-vsce/issues/1275
- Rollout comment: https://github.com/microsoft/vscode-vsce/issues/1275#issuecomment-5237353774
- Future `vsce` flow: https://github.com/microsoft/vscode-vsce#trusted-publishing

Treat the open issue and missing Marketplace policy UI as authoritative. Do
not assume that the presence of `--oidc` means the server rollout is complete.

## Current process: Entra ID

Use the Entra-backed publishing identity that is a Contributor to the
`Chain-Frost` Marketplace publisher.

For an interactive publish:

```bash
az login
npm run publish:vsix
```

For Azure Pipelines, follow Microsoft's secure automated publishing guide:
https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace

`.github/workflows/publish-vscode.yml` remains manual-only. It intentionally
has no GitHub Release trigger while Marketplace OIDC is unavailable.

## Future OIDC migration checklist

After Microsoft closes the tracking issue and the trusted-policy UI is visible:

1. Confirm the current official `vsce` and Marketplace instructions.
2. Create a Marketplace trusted-publishing policy with:
   - GitHub owner: `Chain-Frost`
   - Repository: `tuflow_validator`
   - Workflow: `.github/workflows/publish-vscode.yml`
   - Environment: unset, unless a matching GitHub Environment is added
3. Restore the automatic trigger in `publish-vscode.yml`:

   ```yaml
   release:
     types: [published]
   ```

4. Confirm the workflow publish step still calls `npm run publish:vsix:oidc`.
5. Retain job-level `id-token: write` and repository `contents: read` only.
6. Publish a new patch version and verify it in the Marketplace.

Do not test trusted publishing by republishing an existing version. Marketplace
versions are immutable, so use a new patch release.

## Pieces already prepared

- `@vscode/vsce` 3.9.2 is installed.
- The future workflow uses Node.js 22.
- Manual runs require an existing immutable release tag.
- The tag must exactly match the version in `package.json`.
- The complete integration suite runs before publishing.
- `.vscodeignore` excludes GitHub workflow metadata from the VSIX.

## Dependency-audit follow-up

Upgrading `vsce` substantially rewrote `package-lock.json`. The install and
packaging checks succeeded, but `npm audit` reported the following snapshot:

- 1 low-severity vulnerability
- 7 moderate-severity vulnerabilities
- 12 high-severity vulnerabilities

Handle dependency remediation separately from publishing authentication. Review
`npm audit` output, determine whether findings affect shipped runtime code or
development-only tooling, and test targeted upgrades. Do not run
`npm audit fix --force` as part of the authentication migration.

Update the status date and this checklist when Microsoft's rollout state
changes.
