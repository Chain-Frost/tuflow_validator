#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Wrapper so npm runs inside your Docker container when `DOCKER_EXEC` is set.
run_npm() {
  if [[ -n "${DOCKER_EXEC:-}" ]]; then
    $DOCKER_EXEC npm "$@"
  else
    npm "$@"
  fi
}

# Same wrapper for npx so packaging commands run in the container as well.
run_npx() {
  if [[ -n "${DOCKER_EXEC:-}" ]]; then
    $DOCKER_EXEC npx "$@"
  else
    npx "$@"
  fi
}

# Install dependencies/build the project before packaging the VSIX.
run_npm install
run_npm run compile
run_npx vsce package
