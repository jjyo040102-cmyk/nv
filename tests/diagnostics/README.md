# Optional diagnostics

The active release checks use the locked dependencies and the production better-sqlite3 driver:

```sh
npm ci
npm run check
npm run test
npm run build
npm run test:e2e
```

The optional historical node:sqlite diagnostic runner remains separate from release evidence. Removed local model installation and inference cases are not part of the current tests. Runtime logs and old validation counts under data/runtime describe previous source versions; use the current cleanup report for this revision.
