# Notion Agent Cache

English | [Русский](README.ru.md)

[![Tests](https://github.com/shbontour/notion-agent-cache/actions/workflows/test.yml/badge.svg)](https://github.com/shbontour/notion-agent-cache/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Local read-only Notion snapshots for coding agents and command-line search.

Локальный read-only кэш Notion в Markdown для Codex, Claude Code, Cursor и
других coding agents.

`notion-agent-cache` syncs selected Notion pages, databases, and data sources
into a local Markdown cache. Coding agents can then search project notes with
plain filesystem tools instead of calling the Notion API on every turn.

The cache is not a Notion backup or a source of truth. Notion remains canonical.

## Why

Agent workflows often need durable project context: runbooks, design notes,
release decisions, infrastructure docs, and meeting notes. Keeping that context
only in Notion creates three problems:

- agents need network access and a Notion token for every lookup;
- repeated API reads are slow and noisy;
- broad Notion access can expose pages the agent should not see.

This tool keeps the access model narrow. You share only safe pages with a Notion
integration, sync them into a user-private cache, and let agents use local
search.

## What You Can Do With It

Use `notion-agent-cache` when your team keeps important project knowledge in
Notion, but you do not want to give a coding agent broad live access to the
whole workspace.

After a sync, you can ask an agent to work from real team docs:

- "Find our production deploy checklist and update the release workflow."
- "Look up the architecture decision about auth before changing this module."
- "Use the support runbook to draft a fix plan for this incident."
- "Check the onboarding notes and explain how this service is supposed to run."
- "Search past release notes before writing the changelog."

The agent reads local Markdown files, not your entire Notion workspace.

## Typical User Journey

1. A maintainer already has project docs in Notion: runbooks, release
   checklists, architecture decisions, onboarding notes, and meeting summaries.
2. They create a dedicated Notion integration with read-only access.
3. They share only safe pages or databases with that integration.
4. They run `notion-agent-cache sync`.
5. The tool writes a local snapshot under `~/.cache/notion-agent-cache/current`.
6. Codex, Claude Code, Cursor, or another coding agent can now search that
   folder with normal filesystem tools.

Before:

```text
"How do we deploy production?"
The agent does not know and asks you to paste the Notion page.
```

After:

```text
"Find our production deploy checklist and update the GitHub Action to match it."
The agent searches the local Notion cache and works from the team's docs.
```

## What Happens Next

If the description sounds useful, this is the practical path:

1. You decide which Notion pages are safe for agents to read.
   For example: project docs, release checklists, runbooks, architecture
   decisions, onboarding notes.
2. You create a separate Notion integration for this tool.
   Think of it as a read-only key for one small part of your Notion workspace.
3. You share only those safe pages with the integration.
   The tool cannot read pages you did not share with it.
4. You install `notion-agent-cache` on your computer or server.
5. You put the Notion integration token into a private local file.
   The token is not committed to Git and is not shown to the agent.
6. You add allowed Notion pages with `notion-agent-cache add <notion-url>`.
7. You run `notion-agent-cache sync`.
   The tool creates local Markdown files from those Notion pages.
8. Your coding agent can now search those local files.
   You can ask things like "use our release checklist" or "check the auth
   decision before editing this code."
9. Later, you can run the sync again or schedule it nightly.

You do not have to move your docs out of Notion. This tool just creates a local,
agent-readable copy of the pages you explicitly allowed.

## Features

- Exports Notion pages to Markdown.
- Stores a manifest with page titles, URLs, timestamps, counts, exclusions, and
  sync errors.
- Keeps raw page, block, database, and data source JSON for debugging.
- Follows child pages and child databases discovered from exported pages.
- Supports Notion data sources introduced in the newer database API.
- Uses an allowlist by default: explicit page IDs, database IDs, data source
  IDs, or search queries.
- Excludes secret-looking page titles with configurable regex patterns.
- Keeps rotating timestamped snapshots and updates a `current` pointer.
- Ships a tiny local search CLI.
- Has no runtime npm dependencies.

## Requirements

- Node.js 18.17 or newer.
- A Notion internal integration with read-content access.
- Selected Notion pages or databases shared with that integration.

The default Notion API version is `2026-03-11`. Data source endpoints are
available in the Notion API from `2025-09-03` onward.

## Install From Source

```bash
git clone https://github.com/shbontour/notion-agent-cache.git
cd notion-agent-cache
npm link
```

Package publishing can later replace `npm link` with:

```bash
npm install -g notion-agent-cache
```

## Quick Start

Create the local config:

```bash
notion-agent-cache init
```

Create a Notion integration, copy its token, and save it locally:

```bash
printf '%s\n' '<notion integration token>' > ~/.config/notion-agent-cache/notion-token
chmod 600 ~/.config/notion-agent-cache/notion-token
```

Share safe Notion pages with that integration, then add the page URLs:

```bash
notion-agent-cache add https://www.notion.so/your-workspace/Release-checklist-00000000000000000000000000000000
```

If you need to add something other than a page:

```bash
notion-agent-cache add --database <notion-database-url-or-id>
notion-agent-cache add --data-source <notion-data-source-url-or-id>
notion-agent-cache add --query "release checklist"
```

Run a dry run first:

```bash
notion-agent-cache sync --dry-run
```

Write the first snapshot:

```bash
notion-agent-cache sync
```

Check setup:

```bash
notion-agent-cache doctor
```

Search locally:

```bash
notion-agent-cache search "release checklist"
```

The old direct commands are still available if you want them:

```bash
notion-agent-cache-sync
notion-agent-cache-search "release checklist"
```

You can also use regular shell tools:

```bash
rg "release checklist" ~/.cache/notion-agent-cache/current/pages
```

## Configuration

Default paths:

- Config: `~/.config/notion-agent-cache/config.json`
- Token: `~/.config/notion-agent-cache/notion-token`
- Cache: `~/.cache/notion-agent-cache`

Environment overrides:

- `NOTION_API_KEY` or `NOTION_TOKEN`: token value.
- `NOTION_AGENT_CACHE_CONFIG`: config path.
- `NOTION_AGENT_CACHE_DIR`: cache path for the search CLI.
- `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`: base directories for default paths.

Config keys support both snake_case and camelCase. The example uses snake_case.

Important keys:

- `export_all_shared`: export every page visible to the integration. Keep this
  `false` unless the integration has access only to safe pages.
- `include.page_ids`: specific Notion page IDs or URLs.
- `include.database_ids`: database container IDs.
- `include.data_source_ids`: data source IDs.
- `include.search_queries`: Notion search terms used as export roots.
- `exclude_title_patterns`: case-insensitive regex strings checked before a
  page, database, or data source is queued.
- `retention_snapshots`: number of timestamped snapshots to keep.
- `max_pages`: guardrail that stops runaway exports.

## Snapshot Layout

```text
~/.cache/notion-agent-cache/
  current -> snapshots/<timestamp>/
  snapshots/
    <timestamp>/
      README.md
      manifest.json
      pages/
        <page-id>.md
      raw/
        pages/
        blocks/
        databases/
        data_sources/
```

On platforms where directory symlinks are unavailable, `current` is copied as a
plain directory.

## systemd Timer

For a user-level nightly sync:

```bash
install -d -m 700 ~/.config/systemd/user
cp systemd/notion-agent-cache.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now notion-agent-cache.timer
```

Check status:

```bash
systemctl --user list-timers notion-agent-cache.timer
systemctl --user status notion-agent-cache.service
journalctl --user -u notion-agent-cache.service -n 80
```

If the CLI is not installed globally, edit
`~/.config/systemd/user/notion-agent-cache.service` and point `ExecStart` to the
local script path.

## Security Model

This project is read-only from Notion's perspective, but the local cache can
still contain private content.

- Use a dedicated Notion integration.
- Share only pages that agents are allowed to read.
- Keep `export_all_shared=false` by default.
- Store tokens outside the repository.
- Keep token and cache files user-private.
- Extend `exclude_title_patterns` for your organization's secret-page naming.
- Do not commit generated snapshots.

## Development

```bash
npm run check
```

The check runs syntax validation for both CLI scripts and the Node test suite.

## Limitations

- The Markdown conversion is intentionally simple and optimized for search, not
  pixel-perfect Notion rendering.
- File attachments are recorded as names or URLs; files are not downloaded.
- Linked data sources require the original source database to be shared with
  the Notion integration.
- Search is a lightweight local substring scorer, not semantic search.

## License

MIT
