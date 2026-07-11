# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability.
Report it privately to the repository owner with affected versions, a concise
reproduction, and any proposed mitigation. We will acknowledge receipt within
seven days and coordinate disclosure after a fix is available.

## Deployment notes

- Keep `MINIROUTER_SOLO=false` outside local development.
- Put MiniRouter behind TLS and restrict access to the admin endpoints.
- Provider API keys managed through the admin API are stored in the local
  SQLite database. Protect the data directory with filesystem permissions and
  encrypted volumes; do not publish database backups.
