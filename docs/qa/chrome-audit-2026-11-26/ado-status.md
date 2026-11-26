# AC-05 — Azure DevOps attachment status

**Status: blocked**

This audit produced a complete local evidence pack under `docs/qa/chrome-audit-2026-11-26/`. Attachment to the Azure DevOps Issue was not performed because:

1. No Azure DevOps Issue / work-item ID was supplied for P4-F-CHROME in this session.
2. No Azure DevOps MCP or authenticated `az boards` / REST binding is available to the agent here.

## Attach when the Issue ID is known

Upload at least:

- `README.md` (findings + AC table)
- `BACKLOG.md`
- `isolation.json`
- `public-accessibility.json`
- `metadata.json`
- `responsive.json`
- `performance.json`
- `keyboard.json`
- `http-checks.json`
- `admin.json` / `admin-site17.json`
- Representative PNGs: `home-main-1440.png`, `404-1440.png`, `brand-1440.png`, `home-empty-1440.png`, `admin-workspace-1440.png`, `search-results-1440.png`

Then mark AC-05 done on the Issue and link child stories from [BACKLOG.md](BACKLOG.md).
