# Archive

Files moved here are **not actively maintained** — they're kept for reference:

- `registry.ts` — Old model registry with hardcoded data (replaced by SQLite + `seed-data.json`)
- `extract-models.mjs` — One-time extraction tool for `seed-data.json`
- `update-log.md` — One-time model update log (2026-07-03)
- Various audit scripts (`analyze-routing.mjs`, `audit-*.mjs`, `usage-by-window.mjs`) — One-time DB queries
- `headroom-cache-experiment.mjs` — Design exploration document
- `restart.bat`, `start-headroom.bat`, `stop-headroom.bat` — DEPRECATED Windows batch files for local dev
- `setup-server.sh`, `minirouter.service` — DEPRECATED systemd deployment (Docker is now the primary method)
- `docs/superpowers/` — Pi framework planning documents (infra management plan, already implemented)

These files are safe to delete if you're confident they're no longer needed.