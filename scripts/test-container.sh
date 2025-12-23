#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "Node: $(node -v)"
echo "npm: $(npm -v)"

if [[ -d node_modules ]]; then
  npm install
else
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi

npm run compile
npm run lint
node ./out/test/runTest.js
