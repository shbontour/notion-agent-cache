# Contributing

Small, focused changes are easiest to review.

## Development

This project has no runtime npm dependencies. Use Node.js 18.17 or newer.

```bash
npm run check
```

Useful checks while editing:

```bash
node --check bin/notion-agent-cache.mjs
node --check bin/notion-agent-cache-sync.mjs
node --check bin/notion-agent-cache-search.mjs
node --test
```

## Pull requests

- Keep the cache read-only from Notion's perspective.
- Do not add telemetry, analytics, or network calls outside the Notion API.
- Do not commit example tokens, private page IDs, raw cache snapshots, or
  workspace-specific paths.
- Update the README when CLI behavior or config keys change.
