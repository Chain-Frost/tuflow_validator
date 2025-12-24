#!/usr/bin/env bash
set -euo pipefail

# Entry point for releasing: install/compile/test/package/publish and optional tags+GH release.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

usage() {
  cat <<'EOF'
Usage: scripts/release.sh [--skip-tests] [--skip-publish] [--tag] [--gh-release]

Runs the release workflow: compile, test, package VSIX, publish.
Optional: create a git tag (vX.Y.Z) and a GitHub release with the VSIX attached.

Environment:
  VSCE_PAT     VS Code Marketplace token (required for publish).
  DOCKER_EXEC  Prefix for running npm/npx in a container, e.g. "docker exec -i <ctr>".
  GH_TOKEN     GitHub token with repo scope (used by gh if needed).
EOF
}

# Track CLI flags so we can skip specific steps or enable tagging/releasing.

skip_tests=0
skip_publish=0
do_tag=0
do_gh_release=0

for arg in "$@"; do
  case "$arg" in
    --skip-tests) skip_tests=1 ;;
    --skip-publish) skip_publish=1 ;;
    --tag) do_tag=1 ;;
    --gh-release) do_gh_release=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; usage; exit 1 ;;
  esac
done

# Helper that respects `DOCKER_EXEC` so npm runs inside your container if needed.
run_npm() {
  if [[ -n "${DOCKER_EXEC:-}" ]]; then
    $DOCKER_EXEC npm "$@"
  else
    npm "$@"
  fi
}

# Same wrapper for tools invoked via npx.
run_npx() {
  if [[ -n "${DOCKER_EXEC:-}" ]]; then
    $DOCKER_EXEC npx "$@"
  else
    npx "$@"
  fi
}

echo "==> Install dependencies"
# Ensures lockfile matches before building/publishing.
run_npm install

echo "==> Compile"
run_npm run compile

if [[ "$skip_tests" -eq 0 ]]; then
  echo "==> Test"
  # Run the checked-in test harness to verify the extension.
  run_npm test
else
  echo "==> Skipping tests"
fi

echo "==> Package VSIX"
run_npx vsce package

if [[ "$skip_publish" -eq 0 ]]; then
  if [[ -z "${VSCE_PAT:-}" ]]; then
    echo "VSCE_PAT is not set. Export VSCE_PAT=your_token to publish." >&2
    exit 1
  fi
  echo "==> Publish VSIX"
  # Publishes to the Marketplace using the PAT set above.
  run_npx vsce publish -p "$VSCE_PAT"
else
  echo "==> Skipping publish"
fi

# Derive the git tag name directly from the `package.json` version.
version="$(node -p "require('./package.json').version")"
tag="v${version}"

if [[ "$do_tag" -eq 1 ]]; then
  # Pushes a semver tag matching the package version.
  echo "==> Create git tag $tag"
  git tag "$tag"
  git push origin "$tag"
fi

if [[ "$do_gh_release" -eq 1 ]]; then
  vsix_file="$(ls -1 *.vsix | tail -n 1 || true)"
  if [[ -z "$vsix_file" ]]; then
    echo "No .vsix file found in repo root." >&2
    exit 1
  fi
  if command -v gh >/dev/null 2>&1; then
    # Upload the packaged VSIX via the GitHub CLI release flow.
    echo "==> Create GitHub release $tag with $vsix_file"
    gh release create "$tag" "$vsix_file" --title "$tag" --notes ""
  else
    echo "gh CLI not found. Install gh or create the release manually." >&2
    exit 1
  fi
fi
