# Routing MVP

MiniRouter runs as a local HTTP gateway. It accepts OpenAI Chat Completions at
`/v1/chat/completions` and Anthropic Messages at `/v1/messages`.

## Required slots

Configure `balanced`, `strong`, and `vision` in the root `.env` file. Start
from [`.env.example`](../.env.example). The `fast` slot is optional and can be
selected explicitly with `minirouter/slot/fast`.

The readiness endpoint reports the configured slots:

```bash
curl http://localhost:8402/health/ready
```

## Start

```bash
npm ci
npm run build
npm start
```

For production, set `MINIROUTER_SOLO=false` and
`MINIROUTER_BOOTSTRAP_ADMIN_EMAIL` before the initial start. See the root
[README](../README.md) for the bootstrap flow and API examples.

## Routing models

- `minirouter/auto` — route by request difficulty and capabilities.
- `minirouter/eco` — prefer `balanced`.
- `minirouter/premium` — prefer `strong`.
- `minirouter/slot/<slot>` — force `fast`, `balanced`, `strong`, or `vision`.

Image, audio, and video requests require a configured `vision` slot. MiniRouter
forwards the compatible request directly to that slot; it does not perform a
separate visual preprocessing pass.
