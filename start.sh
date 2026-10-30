#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "Install Node.js 24 LTS."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required."; exit 1; }
node scripts/check-runtime.mjs
if [ ! -f node_modules/.package-lock.json ]; then npm ci; fi
node scripts/initialize-local-env.mjs
npm run db:migrate
npm run seed:demo
node scripts/open-browser.mjs http://127.0.0.1:3000 >/dev/null 2>&1 &
npm run dev -- --port 3000
