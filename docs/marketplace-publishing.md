# Marketplace publishing

Status reviewed: **24 November 2026**. Scope: **Path Validator only**
(`Chain-Frost.tuflow-path-validator`). TUFLOW Helper's Marketplace identity and
publishing arrangements are outside this work.

## What is ready and what is not

Microsoft announced GitHub Actions Trusted Publishing on 28 October 2026. The
Marketplace publisher portal now supports a policy identifying a repository,
workflow filename and, optionally, a GitHub environment. The previous advice to
wait for `microsoft/vscode-vsce#1275` to close is obsolete.

Primary sources:

- [Microsoft's Trusted Publishing announcement](https://developer.microsoft.com/blog/trusted-publishing-visual-studio-marketplace/)
- [VS Code publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)
- [Official vsce repository](https://github.com/microsoft/vscode-vsce)

| Component | Verified status for this preparation |
| --- | --- |
| Microsoft service and GitHub policy support | Available according to Microsoft's current documentation. |
| Repository workflow and local tooling | Manual-only, version-pinned workflow; first production OIDC release of 0.2.7 succeeded in [run 45228773579](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45228773579). |
| GitHub `production` environment | Configured with required reviewer `Chain-Frost`, workable self-approval, no admin bypass, and deployment branch `main` only. |
| Marketplace policy for publisher `Chain-Frost` | Owner-verified Active: `Path Validator production`, repository `Chain-Frost/tuflow_validator`, workflow filename `publish-vscode.yml`, environment `production`. |
| Real OIDC exchange and Marketplace publication | **Succeeded** for 0.2.7 through the approved production job on 23 November 2026. Marketplace package and normal installed-profile acceptance are separate checks tracked in #10. |
| GitHub Release automation | Issue #36 adds a post-publish job; it runs only after approved Marketplace publication, with isolated `contents: write`, and attaches that run's verified VSIX/checksum. The already-published 0.2.7 needs a separately authorised one-time backfill. |

These settings have been verified and the first `v0.2.7` Marketplace publish
completed. Issue [#12](https://github.com/Chain-Frost/tuflow_validator/issues/12)
tracks final delivery acceptance; [#10](https://github.com/Chain-Frost/tuflow_validator/issues/10)
tracks the user's normal installed build. A GitHub Release page alone is not
proof of Marketplace-delivered runtime equivalence.

## Reproducible tooling and runtime boundary

`@vscode/vsce` is pinned to **4.1.1**, the current official npm release checked
for this change. It requires Node 22 or later. `.nvmrc` pins **Node 22.23.5** for
PR CI, benchmarking and publishing preparation. The lockfile was regenerated
with Node 22.23.5 and npm 10.9.7; installation uses `npm ci`.

This is the **build and publishing toolchain**. It does not raise the Node API
floor inside VS Code or change `engines.vscode`. The independently reviewed VS
Code 1.74 compatibility change is tracked in
[#13](https://github.com/Chain-Frost/tuflow_validator/issues/13).

The OIDC npm script is exactly:

```json
"publish:vsix:oidc": "vsce publish --oidc"
```

`npm run` resolves the locked local executable. It does not download a new
version with `npx`. The workflow publishes the previously tested VSIX with
`--packagePath`; it does not increment a version or rebuild after approval.

## Exact configuration required before a release

Before future releases, **reverify** the existing GitHub `production` environment,
its actual required reviewer, branch restriction to `main`, owner self-approval
arrangement and administrator-bypass prohibition.
The workflow checks that a nonempty required-reviewer rule exists; an absent or
unprotected environment fails before the publishing job. Writing
`environment: production` in YAML alone does not create an approval policy.

In Visual Studio Marketplace publisher management, open publisher
**Chain-Frost**, select **Trusted Publishing**, and create/verify this policy:

| Portal field | Exact value |
| --- | --- |
| Policy name | A descriptive name, for example `Path Validator production` |
| Repository owner | `Chain-Frost` |
| Repository | `tuflow_validator` |
| Workflow | `publish-vscode.yml` — the filename, without `.github/workflows/` |
| Environment | `production` — must match the GitHub environment exactly |

Record the policy status and verified configuration without copying credentials
or tokens into GitHub. No Marketplace PAT is needed or used by this workflow.
The existing explicit Microsoft Entra publishing commands remain available;
they are not invoked as an automatic fallback from OIDC.

Protect release tags against updates and deletion using repository rules for
`v*`. The workflow detects tag/commit mismatches and rechecks the tag object after
approval. These checks detect movement; repository rules provide immutability.
They must not be described as configured until verified in GitHub settings.

## Release workflow

`.github/workflows/publish-vscode.yml` has only a manual `workflow_dispatch`
trigger. Dispatch it from `main`, after release approval, with an existing
stable `vMAJOR.MINOR.PATCH` tag and the full lowercase 40-character reviewed
commit SHA. The source commit must already be on `main`, and the tag must match
the version in its `package.json`. Marketplace does not accept semantic
prerelease version strings; this workflow deliberately accepts stable versions.

1. The verification job checks out the policy at the dispatch workflow's own
   immutable SHA separately from the candidate source. The candidate cannot
   replace the script that decides whether it is allowed to publish.
2. That trusted guard verifies the exact checkout/tag target, `main` ancestry,
   package version, publisher/extension identity and OIDC command. The job checks
   the configured environment, installs the lockfile, runs release-guard tests
   and the actual extension-host suite, and packages and inspects the VSIX.
3. The VSIX and its SHA-256 checksum are retained as an artifact from this run.
   Verification has `contents: read` and no OIDC token permission.
4. The `production` approval gate precedes a separate publishing job. Only this
   job receives `id-token: write` alongside `contents: read`. It installs locked
   tooling without lifecycle scripts, retrieves this run's package, reruns the
   trusted guard, checks that the remote tag object has not moved, and verifies
   the package checksum before publishing the existing VSIX with `--oidc`.

A shared concurrency group prevents overlapping Marketplace publishing jobs;
an active release is not cancelled by a newer dispatch. Checkout credentials are
not persisted. There is no automatic release trigger, PAT secret, version
auto-increment or duplicate-version bypass. After publication succeeds, a
third job creates the **GitHub Release** using the verified same-run VSIX
and SHA-256 sidecar, with permission `contents: write` only in that job.
It uses `gh release create --verify-tag` and will not replace an existing
release. A publish failure cannot create a GitHub Release.

OIDC failures stop the job. Inspection of the pinned vsce client confirms that
`--oidc` selects OIDC authentication and propagates exchange errors rather than
trying a stored PAT or Entra credential. `npm run test:release` checks invalid
release metadata, moved tags, unmerged commits, a candidate that substitutes
its own guard, missing OIDC context and a mocked policy rejection. These tests
make **no real token request or publication**.

## Validation and remaining acceptance

Routine PR CI checks locked installation, release-guard tests, TypeScript,
ESLint, actual Windows/Linux extension hosts, VSIX packaging and the exact
archive boundary. `.nvmrc`, scripts, tests, dependencies and documentation are
excluded from the shipped archive. The existing verifier expects 17 entries,
including 11 runtime JavaScript modules.

For each future OIDC release, confirm environment protections, tag rules,
the exact Marketplace policy, available new version and explicit owner
authorisation for the approved source/tag/dispatch. Do not use an existing
Marketplace version as an authentication test. The first real OIDC publish
completed for `v0.2.7` in [run 45228773579](https://github.com/Chain-Frost/tuflow_validator/actions/runs/45228773579).
The original `v0.2.7` workflow did not yet create a GitHub Release.
Do **not** rerun its Marketplace publication to backfill the Release:
recover only from the verified same-run artifact, under separate owner approval.
The GitHub Release is created after OIDC success; actual Marketplace-delivered
package and installed-host acceptance remain distinct.

## Dependency audit snapshot

An npm audit comparison on 23 November 2026 reported:

| Locked development tree | Low | Moderate | High | Critical | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Existing main toolchain | 1 | 9 | 13 | 0 | 23 |
| This vsce 4.1.1 update | 1 | 6 | 8 | 0 | 15 |

These are development/publishing dependencies; the VSIX contains no runtime
node_modules. They still matter when running development and release tools.
The remaining reports include glob/minimatch, Mocha and older Open VSX tooling
transitives. The official latest vsce itself still has a transitive advisory
report. Treat this as a dated audit snapshot, not a claim of a vulnerability-free
toolchain. Review targeted compatible fixes separately; do not use
`npm audit fix --force` or downgrade away from supported OIDC to silence it.
