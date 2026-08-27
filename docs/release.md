# Release Process

This extension is published to the VS Code Marketplace with `vsce` and
Microsoft Entra ID. Publishing does not use a Personal Access Token (PAT).

## Prereqs
- `@vscode/vsce` 2.26.1 or newer (installed by this project).
- A user-assigned Azure managed identity.
- An Azure DevOps Azure Resource Manager service connection configured with
  workload identity federation for that managed identity.
- The managed identity's Azure DevOps profile ID added to the `Chain-Frost`
  Marketplace publisher with the Contributor role.
- The publishing pipeline granted access to the service connection.
- Logged in to GitHub and permission to create releases.

Follow the official setup sequence at
https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace.

## Azure Pipeline publishing
Run the release command inside an `AzureCLI@2` task whose `azureSubscription`
is the workload-identity service connection:

```yaml
- task: AzureCLI@2
  displayName: Publish VS Code extension
  inputs:
    azureSubscription: <ServiceConnectionName>
    scriptType: bash
    scriptLocation: inlineScript
    inlineScript: |
      npm ci
      npm run compile
      npm run lint
      npm run publish:vsix
```

The Azure CLI task signs in using the federated managed identity. `vsce
publish --azure-credential` obtains a short-lived Microsoft Entra access token
from that login.

For an interactive check, `az login` followed by `npm run publish:vsix` uses
the signed-in Azure CLI identity. That identity must also be a Contributor to
the Marketplace publisher.

## Steps
1. Update `package.json` version and keep `package-lock.json` in sync.
2. Run `npm run compile` and `npm test` locally.
3. Create the VSIX with `npm run package:vsix` (this creates a versioned `.vsix` file).
4. Publish:
   - Marketplace: run `npm run publish:vsix` inside the configured
     `AzureCLI@2` task.
5. Tag and release on GitHub:
   - Create a tag like `v0.1.8`.
   - Create a GitHub Release and attach the `.vsix`.

## Scripted workflow
- `scripts/release.sh` runs compile/test/package/publish and can optionally tag and create a GitHub release.
- Container usage: set `DOCKER_EXEC="docker exec -i <container>"` to run npm/npx inside your container.
- Examples:
  - `scripts/release.sh` (compile/test/package/publish)
  - `scripts/release.sh --tag --gh-release` (also tag and create a GitHub release)
