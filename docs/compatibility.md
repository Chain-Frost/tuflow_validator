# VS Code compatibility

Path Validator requires **VS Code 1.74.0 or newer** (`engines.vscode: ^1.74.0`),
matching TUFLOW Helper. The API declarations are pinned to `@types/vscode`
**1.74.0**, so ordinary compilation rejects accidental use of a later VS Code
API. Versions below 1.74 are outside the supported contract.

## Build tools and extension host

CI uses **Node.js 22** for dependency installation, TypeScript, ESLint, packaging
and the test launcher. That does not require users to install Node 22 or imply
that VS Code 1.74 contains Node 22. VS Code supplies its own extension-host
runtime; the acceptance artifacts record its actual Node and Electron versions.

The production extension has no packaged npm runtime dependencies. Its compiled
output remains CommonJS/ES2020 and its Node declarations remain `16.x`. The
compatibility change introduces no production code or new runtime API usage.

### API/runtime audit

The current production surface was checked against the pinned 1.74 declarations:

| Surface | Production usage | Verification |
| --- | --- | --- |
| Activation and language | `onLanguage`, `workspaceContains`, `TextDocument`, extension subscriptions | Real minimum/current hosts; installed VSIX activates when a TUFLOW document opens |
| Diagnostics | Diagnostic collections, ranges, severity, structured codes and target URIs | Full integration suite and installed missing/present-input smoke tests |
| Code actions | `registerCodeActionsProvider`, `CodeAction`, `WorkspaceEdit` | Full suite and installed diagnostic Quick Fix availability |
| Watchers/configuration | `RelativePattern`, `createFileSystemWatcher`, document/configuration events | 1.74 type check and existing native-filesystem integration tests |
| Formatting | `registerDocumentFormattingEditProvider`, `FormattingOptions`, `TextEdit` | Existing tab/space/idempotence suite and installed opt-in formatting checks |
| Node/JavaScript | `fs.readFileSync`, `existsSync`, `readdirSync({withFileTypes:true})`, `path`, `Map`, `Set`, timers and ES2020 syntax | No Node 18/22/24-only production calls; execute the real VS Code 1.74 host rather than equating build Node with runtime Node |

No proposed VS Code APIs are used. Runtime compatibility still needs execution;
type checking alone is not a claim that activation, editor events or platform
filesystem behavior works.

## Automated acceptance

The `Extension tests` workflow runs the full existing suite and VSIX verifier on
**Windows and Linux**, each against **1.74.0 and current Stable**. The actual
editor and extension-host Node versions are printed in the test log.

Each job then builds Helper at commit
`38ebb604697b21d7b45929e1ec989dad8559c94a` and runs two fresh, disposable profiles:

1. Installed Validator alone.
2. Installed Validator plus the pinned Helper VSIX.

The development extension used by the smoke runner is a harmless test probe.
The assertions require Validator/Helper to be loaded from the isolated installed
extensions directory, preventing the source checkout from substituting for the
VSIX. Each profile checks activation, shared language, missing and existing
inputs, conditional missing-input severity, numeric/unresolved-token negatives,
Quick Fix registration and optional formatting. The combined profile also checks
Helper activation, completions and command ownership. Only disposable control
files are written; no existing model or GeoPackage is accessed.

`compatibility-<OS>-<requested version>` artifacts retain the actual editor/Node
versions, checked source SHAs, both VSIX SHA-256 hashes, installed locations and
individual checks. `Stable` intentionally tracks the current editor; its resolved
version is recorded rather than described as a fixed version.

Every installed-host invocation removes old evidence and verifies a fresh unique
invocation ID, mode, source SHAs and package hashes. A zero editor exit without
probe execution fails; the runner's regression tests cover that failure mode.

This is not a network-drive acceptance suite, a minimum-OS certification, or a
claim about every third-party extension. Real UNC/SMB reliability remains
separately tracked. The pinned Helper source is a reproducible coexistence
fixture, not a statement about an unverified Marketplace artifact.

## Reproduce

Use Node 22, `npm ci`, then `npm test` with `TPV_VSCODE_VERSION=1.74.0` (or
`stable`). On headless Linux use `xvfb-run -a npm test`.

For installed acceptance, run `npm run package:vsix:ci` and
`python scripts/verify-vsix.py validator-ci.vsix`. Build the pinned Helper commit
using its locked dependencies and `npm run package:vsix`, set `TPV_HELPER_VSIX`
to that package and `TPV_HELPER_SOURCE_SHA` to the pinned commit, then run
`npm run test:compatibility` (under Xvfb on headless Linux). The Helper VSIX must
remain in that checkout so the runner can verify its source identity. Scripts
create and remove dedicated temporary profiles; they do not use the user's
normal VS Code profile.

Official references: [extension manifest and engine contract](https://code.visualstudio.com/api/references/extension-manifest),
[extension testing and version selection](https://code.visualstudio.com/api/working-with-extensions/testing-extension),
[VS Code 1.74 release notes](https://code.visualstudio.com/updates/v1_74).
