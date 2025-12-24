# Release Process

This extension is published to the VS Code Marketplace (vsce).

## Prereqs
- VS Code Marketplace Personal Access Token in `VSCE_PAT`.
- Logged in to GitHub and permission to create releases.

## Steps
1. Update `package.json` version and keep `package-lock.json` in sync.
2. Run `npm run compile` and `npm test` locally.
3. Create the VSIX with `npm run package:vsix` (this creates a versioned `.vsix` file).
4. Publish:
   - Marketplace: `npm run publish:vsix`
5. Tag and release on GitHub:
   - Create a tag like `v0.1.8`.
   - Create a GitHub Release and attach the `.vsix`.

## Scripted workflow
- `scripts/release.sh` runs compile/test/package/publish and can optionally tag and create a GitHub release.
- Container usage: set `DOCKER_EXEC="docker exec -i <container>"` to run npm/npx inside your container.
- Examples:
  - `scripts/release.sh` (compile/test/package/publish)
  - `scripts/release.sh --tag --gh-release` (also tag and create a GitHub release)
