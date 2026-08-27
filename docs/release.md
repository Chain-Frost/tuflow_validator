# Release Process

GitHub Actions publishes this extension to the VS Code Marketplace with
OpenID Connect (OIDC). No Personal Access Token or repository secret is needed.
Publishing a GitHub Release starts `.github/workflows/publish-vscode.yml`.

## One-time Marketplace setup

In the Visual Studio Marketplace publisher portal, configure a trusted
publishing policy for the `Chain-Frost` publisher with these exact values:

- GitHub owner: `Chain-Frost`
- Repository: `tuflow_validator`
- Workflow: `.github/workflows/publish-vscode.yml`
- Environment: leave unset

The workflow has only read access to repository contents plus `id-token: write`.
At publish time, GitHub issues a token for the Marketplace audience and `vsce`
exchanges it for a short-lived publishing credential.

Official guidance:

- https://github.com/microsoft/vscode-vsce#trusted-publishing
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension

## Automated release

1. Update the version in `package.json` and `package-lock.json`.
2. Run `npm test` and `npm run package:vsix` locally.
3. Commit the release changes and push them to `main`.
4. Create and push a matching tag, such as `v0.2.7`.
5. Publish a GitHub Release for that tag and attach the VSIX.
6. GitHub Actions checks out the immutable release tag, confirms that its tag
   matches the package version, runs all tests, and publishes with OIDC.

The workflow can also be rerun manually. Choose **Run workflow** in GitHub
Actions and enter the existing release tag.

## Local release helper

The normal command packages, tags, and creates the GitHub Release. The
Marketplace publish then happens in GitHub Actions:

```bash
scripts/release.sh --tag --gh-release
```

Other useful commands:

- `npm run publish:vsix` publishes with GitHub Actions OIDC and only works in
  the trusted workflow.
- `npm run publish:vsix:entra` publishes interactively using the identity from
  `az login`.
- `scripts/release.sh --publish-entra` runs a direct interactive Marketplace
  publish rather than waiting for the GitHub workflow.
- Set `DOCKER_EXEC="docker exec -i <container>"` to run npm/npx inside a
  container.

Do not combine a direct Entra publish with the GitHub Release workflow for the
same version; Marketplace versions are immutable.
