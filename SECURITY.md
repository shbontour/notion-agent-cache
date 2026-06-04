# Security

`notion-agent-cache` creates a local copy of selected Notion content. Treat the
cache as sensitive unless every exported page is public by design.

## Safe setup

- Share only the pages or databases that should be cached with your Notion
  integration.
- Keep `export_all_shared` set to `false` unless the integration has access
  only to safe pages.
- Store tokens outside the repository. The default token path is
  `~/.config/notion-agent-cache/notion-token`.
- Keep the token file and cache directory readable only by your user.
- Add secret-related title patterns to `exclude_title_patterns` before the
  first sync.

## Reporting

Do not open public issues containing tokens, private Notion page content, or
cache snapshots. Open a security advisory or contact the maintainer privately.
