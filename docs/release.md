# Release Process

This extension is published to the VS Code Marketplace (vsce) and Open VSX (ovsx).

## Prereqs
- VS Code Marketplace Personal Access Token in `VSCE_PAT`.
- Open VSX token in `OVSX_PAT`.
- Logged in to GitHub and permission to create releases.

## Steps
1. Update `package.json` version and keep `package-lock.json` in sync.
2. Run `npm run compile` and `npm test` locally.
3. Create the VSIX with `npm run package:vsix` (this creates a versioned `.vsix` file).
4. Publish:
   - Marketplace: `npm run publish:vsix`
   - Open VSX: `npm run publish:ovsx`
   - Both: `npm run publish:all`
5. Tag and release on GitHub:
   - Create a tag like `v0.1.8`.
   - Create a GitHub Release and attach the `.vsix`.
