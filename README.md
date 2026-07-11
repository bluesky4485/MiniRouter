# MiniRouter

![MiniRouter intelligent model routing gateway](assets/minirouter-hero.png)

MiniRouter is a self-hosted LLM routing gateway for OpenAI Chat Completions and
Anthropic Messages clients. It classifies each request and selects a configured
`fast`, `balanced`, `strong`, or `vision` provider slot, while recording usage,
estimated cost, and routing diagnostics in SQLite.

## What it provides

- OpenAI-compatible `POST /v1/chat/completions` and Anthropic-compatible
  `POST /v1/messages` endpoints.
- Rule-based task classification with `auto`, `eco`, and `premium` profiles.
- Multiple provider channels per slot, weighted selection, cooldowns, and
  provider health tracking.
- API key authentication, user-level rate/spend limits, usage logs, and an
  admin dashboard.
- SQLite storage with automatic migrations; no external database is required.

## Requirements

- Node.js 22 or later
- An OpenAI-compatible or native Anthropic upstream endpoint for each required
  model slot

## Quick start

```bash
git clone https://github.com/lpffernando/MiniRouter.git
cd MiniRouter
cp .env.example .env
# Edit .env: replace the endpoint, model, and API-key placeholders.
npm ci
npm run build
npm start
```

The service listens on `http://localhost:8402` by default. Check its readiness:

```bash
curl http://localhost:8402/health/ready
```

`balanced`, `strong`, and `vision` are required for readiness. `fast` is
optional; absent a fast slot, simple requests fall back to `balanced`.

For local experimentation `.env.example` enables `MINIROUTER_SOLO=true`, which
allows requests without an API key. Never expose that mode to an untrusted
network.

## Production bootstrap

Set these before the first production start:

```env
MINIROUTER_SOLO=false
MINIROUTER_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
```

On first start MiniRouter creates a super-admin and prints a one-time API key
to the service log. Save it, then remove `MINIROUTER_BOOTSTRAP_ADMIN_EMAIL`
from the environment. Use the key as `Authorization: Bearer mr_sk_...` for
the admin API and to create ordinary users and keys.

Run MiniRouter behind TLS and a reverse proxy. See [SECURITY.md](SECURITY.md)
for data-protection guidance.

## API usage

Use one of the routing models:

- `minirouter/auto` — choose a slot from request features and difficulty.
- `minirouter/eco` — prefer the balanced/cost-oriented slot.
- `minirouter/premium` — prefer the strong slot.
- `minirouter/slot/fast`, `/balanced`, `/strong`, or `/vision` — explicitly
  select a slot.

```bash
curl http://localhost:8402/v1/chat/completions \
  -H 'Authorization: Bearer mr_sk_your_key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "minirouter/auto",
    "messages": [{"role": "user", "content": "Summarize this text."}]
  }'
```

Useful endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness check |
| `GET /health/ready` | Required provider-slot configuration check |
| `GET /v1/models` | Available routing and configured models |
| `GET /admin/dashboard` | Management dashboard |
| `GET /admin/overview` | Authenticated platform overview |

## Docker

```bash
docker build -t minirouter:local .
docker run --rm -p 8402:8402 --env-file .env \
  -v minirouter-data:/data minirouter:local
```

The SQLite database is stored below `$HOME/.minirouter`. The image sets
`HOME=/data`, so the named volume persists it at `/data/.minirouter`.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
```

The deployment helper defaults to the repository's `main` branch; override it
with `MINIROUTER_BRANCH` when deploying another branch.

## Additional documentation

- [Routing overview](docs/routing-mvp.md)
- [Routing strategy](docs/routing-strategy.md)
- [Infrastructure management design](docs/infra-management-design.md)
- [Environment variable reference](.env.example)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
