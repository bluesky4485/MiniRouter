# MiniRouter

![MiniRouter intelligent model routing gateway](assets/minirouter-hero.png)

MiniRouter is a self-hosted LLM dispatch gateway. Rather than blindly forwarding
every request to the same model, it first evaluates the task's difficulty, then
picks the right model for the job — fast, balanced, strong, or vision. Every
request lands on the most cost-effective model for what it actually needs to do.

**Simple tasks save money. Complex tasks keep quality. Every route is explainable.**

A strong model is great — but "fix a typo" shouldn't burn the same resources as
"debug this distributed system."

From the consumer's perspective it's still one unified API — `model = minirouter/auto`.
Behind the scenes it handles:

- **Model slot selection** — 14-dimension rule classifier scores the prompt, maps to SIMPLE / MEDIUM / COMPLEX / REASONING tiers
- **Multi-channel weighted routing with cooldown** — multiple provider channels per slot, weighted round-robin with automatic failover
- **OpenAI & Anthropic compatible** — native passthrough on `/v1/chat/completions` and `/v1/messages`, no protocol translation
- **API key, user quota & spend limits** — multi-user, multi-key, daily / monthly rate limiting
- **Full audit trail** — latency, token usage, cost estimate, and routing reason all logged to SQLite
- **Admin dashboard** — visual overview of usage patterns and model performance

Technical highlights:

- **Zero runtime cost** — all routing runs locally in under 1 ms
- **No external database** — SQLite with automatic migrations, zero config
- **Native passthrough** — no format adaptation between protocols; each endpoint speaks its own wire format end-to-end

## How routing works

A 14-dimension rule classifier scores the user prompt, then maps it to a tier:

```
One-sentence edits, light rewrites (SIMPLE)   → FAST slot       cost-effective model (if configured)
Code analysis, tool calls (MEDIUM)            → BALANCED slot   your workhorse
Deep debugging, complex reasoning (COMPLEX)   → STRONG slot     auto-switch to strong model
Math proofs, long context (REASONING)         → STRONG slot     strongest model
Images / multimodal                           → VISION slot     vision-capable model
```

You configure the upstream endpoint for each slot in `.env`. MiniRouter picks
the slot and forwards the request. That's it.

Run `POST /debug/route` to inspect a classification without calling upstream —
every route is explainable.

## Use cases

MiniRouter is designed for scenarios where you have multiple models available
and want to put each request on the right one without hard-coding model names
in your application.

### OpenCode Go / subscription plans

OpenCode Go and similar subscription services offer a pool of models (fast,
balanced, strong, vision) under one monthly plan. MiniRouter turns that single
subscription into an intelligent gateway:

```
Slot configuration:
  FAST     → deepseek-v4-flash  (cheap, fast)
  BALANCED → deepseek-v4-pro    (workhorse)
  STRONG   → glm-5.2            (powerful reasoning)
  VISION   → glm-5.2-vision     (multimodal)
```

Your application calls `minirouter/auto` — MiniRouter picks the cheapest slot
that can handle the task:

- "Fix a typo" → FAST (cheap)
- "Write a CRUD API" → BALANCED (workhorse)
- "Debug a distributed system deadlock" → STRONG (powerful)

**Result:** You get more value from your subscription without any app changes.

### Multi-provider aggregation (e.g. 胜算云 / aggregators)

Aggregation platforms give you a single API key that can reach dozens of
models. MiniRouter lets you assign different models to each slot:

```
FAST     → deepseek-v4-flash  @ $0.15/M
BALANCED → qwen3-120b         @ $0.50/M
STRONG   → claude-sonnet-4    @ $3.00/M
VISION   → gpt-4o            @ $2.50/M
```

All from one API key. The router sends trivial queries to the cheapest model
and only upgrades when the task genuinely needs it.

### Token plan combinations

If you have separate token plans (e.g. a cheap plan for fast models and a
premium plan for strong models), configure each slot with its own plan:

```
# Cheap plan (pre-paid 10M tokens)
MINIROUTER_FAST_BASE_URL=https://fast-tier.example.com/v1
MINIROUTER_FAST_API_KEY=plan_abc123
MINIROUTER_FAST_MODEL=deepseek-v4-flash

# Premium plan (pre-paid 1M tokens)
MINIROUTER_STRONG_BASE_URL=https://premium-tier.example.com/v1
MINIROUTER_STRONG_API_KEY=plan_xyz789
MINIROUTER_STRONG_MODEL=claude-opus-4
```

MiniRouter automatically routes each request to the right plan. Waste fewer
premium tokens on trivial queries.

## Quick start (local)

```bash
git clone https://github.com/lpffernando/MiniRouter.git
cd MiniRouter

# 1. Create your config
cp .env.example .env
# Edit .env: replace BASE_URL, API_KEY, and MODEL for each slot
# Tip: you can also configure channels later via the admin dashboard

# 2. Install and start
npm ci
npm run build
npm start
# MiniRouter listening on http://localhost:8402
# dashboard: http://localhost:8402/admin/dashboard

# 3. First-time setup — open the admin dashboard
#    Visit http://localhost:8402/admin/dashboard
#    → "First-time Setup" tab → register an admin account
#    → Save the API key shown (it won't be shown again)
#    → Now you can add provider channels, create users, etc.
```

`.env.example` enables `MINIROUTER_SOLO=true` so local requests can skip API
keys. **Never expose solo mode to an untrusted network.**

Once channels are configured, verify readiness:

```bash
curl http://localhost:8402/health/ready
# → { "status": "ready" }

## Deploy to a server (Docker)

MiniRouter runs in a two-stage Docker image. The build stage compiles
better-sqlite3 from source; the production stage is a slim Node.js 22
container.

### Option A — docker compose (recommended)

```bash
git clone https://github.com/lpffernando/MiniRouter.git
cd MiniRouter

# 1. Create your config
cp .env.example .env
# Edit .env: replace BASE_URL, API_KEY, and MODEL for each slot

# 2. (Optional) Tune routing parameters
#    Edit docker-compose.yml → environment: section, then `docker compose up -d`
#    (no rebuild needed, just restart).

# 3. Build and start
docker compose up -d

# 4. First-time setup
#    Visit http://<server-ip>:8402/admin/dashboard
#    → "First-time Setup" tab → register an admin account → save the key
#    Note: set MINIROUTER_SOLO=false in .env for production

# 5. Verify
curl http://localhost:8402/health/ready
# → { "status": "ready" }

# 6. Check logs
docker compose logs -f
```

Data persists in the `minirouter-data` Docker volume. To use a bind mount
for direct host access to the SQLite file, edit `docker-compose.yml` and
uncomment the `driver_opts` block.

**China mainland builds:** Set the build arg in `docker-compose.yml`:

```yaml
args:
  USE_CHINA_MIRROR: "true"
  NPM_REGISTRY: "https://registry.npmmirror.com"
```

### Option B — plain docker run

```bash
# Build (China: add --build-arg USE_CHINA_MIRROR=true)
docker build -t minirouter:latest .

# Run
docker run -d \
  --name minirouter \
  --restart unless-stopped \
  -p 8402:8402 \
  -v /opt/minirouter-data:/data \
  --env-file .env \
  minirouter:latest
```

### Option C — deploy.sh (build locally, push to server)

```bash
# Build image locally, scp to server, recreate container
./deploy/deploy.sh your-server-ip 22

# Or run directly on the server
./deploy/deploy.sh
```

### Configuration files

| File | Purpose | In repo? |
| --- | --- | :---: |
| `.env` | Secrets: API keys, base URLs, solo mode | No (gitignored) |
| `.env.example` | Template with all available vars | Yes |

Routing defaults are pinned in `docker-compose.yml` under `environment:`.
Change a value there and run `docker compose up -d` — no image rebuild needed.
Secrets stay in the gitignored `.env` and are loaded via `env_file:`.

### Production bootstrap (first admin)

Two ways to create the first admin:

**Option 1 — Admin dashboard (recommended)**: start the server, visit
`http://<server-ip>:8402/admin/dashboard`, use the "First-time Setup" tab
to register an admin account, and save the returned API key.

**Option 2 — Environment variable**: set in `.env`:

```env
MINIROUTER_SOLO=false
MINIROUTER_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
```

MiniRouter creates a super-admin and prints a one-time API key to the log.
**Save it, then remove `MINIROUTER_BOOTSTRAP_ADMIN_EMAIL`.** Use the key as
`Authorization: Bearer mr_sk_...` to manage users and keys through the admin
API.

### Reverse proxy (Nginx + TLS)

Copy the included Nginx config, swap `YOUR_DOMAIN.COM`, and enable it:

```bash
sudo cp deploy/nginx-minirouter.conf /etc/nginx/sites-available/minirouter
sudo sed -i 's/YOUR_DOMAIN.COM/your-actual-domain.com/g' /etc/nginx/sites-available/minirouter
sudo ln -s /etc/nginx/sites-available/minirouter /etc/nginx/sites-enabled/
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo systemctl reload nginx
```

### Update a running deployment

```bash
# From your laptop
./deploy/deploy.sh your-server-ip

# Or directly on the server after git pull
./deploy/deploy.sh
```

This rebuilds the image, stops the old container, and starts a new one with
the same env/mounts/ports.

## API usage

Set `model` to one of the routing profiles and send a standard OpenAI Chat
Completions request:

```bash
curl -s http://localhost:8402/v1/chat/completions \
  -H 'Authorization: Bearer mr_sk_your_key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "minirouter/auto",
    "messages": [{"role": "user", "content": "Explain Kubernetes in one paragraph."}]
  }'
```

### Routing profiles

| `model`                 | Behaviour                                      |
| ----------------------- | ---------------------------------------------- |
| `minirouter/auto`       | Classify and pick the best-value slot          |
| `minirouter/eco`        | Prefer the balanced slot (cost-optimised)      |
| `minirouter/premium`    | Prefer the strong slot (quality-first)         |
| `minirouter/slot/fast`  | Explicit `fast` slot (if configured)           |
| `minirouter/slot/balanced` | Explicit `balanced` slot                    |
| `minirouter/slot/strong`   | Explicit `strong` slot                      |
| `minirouter/slot/vision`   | Explicit `vision` slot                      |

### Tool calling

```bash
curl -s http://localhost:8402/v1/chat/completions \
  -H 'Authorization: Bearer mr_sk_your_key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "minirouter/auto",
    "messages": [{"role": "user", "content": "What is the weather in Tokyo?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
          "type": "object",
          "properties": { "city": { "type": "string" } },
          "required": ["city"]
        }
      }
    }]
  }'
```

When tools are present, the router automatically switches to agentic routing,
selecting higher-capability slots even for normally-simple requests.

### Anthropic Messages

```bash
curl -s http://localhost:8402/v1/messages \
  -H 'x-api-key: mr_sk_your_key' \
  -H 'anthropic-version: 2023-06-01' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "minirouter/auto",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello, Claude."}]
  }'
```

### Structured output / JSON mode

```bash
curl -s http://localhost:8402/v1/chat/completions \
  -H 'Authorization: Bearer mr_sk_your_key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "minirouter/auto",
    "messages": [{"role": "user", "content": "List 5 dog breeds."}],
    "response_format": { "type": "json_object" }
  }'
```

Requests with structured output are forced to at least the `SIMPLE` tier to
avoid routing JSON generation to the weakest model. You can increase this
with `MINIROUTER_STRUCTURED_OUTPUT_MIN_TIER` if needed.

### Debug a route (no upstream call)

```bash
curl -s http://localhost:8402/debug/route \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "minirouter/auto",
    "messages": [{"role": "user", "content": "Write a Fibonacci function in Rust"}]
  }'
```

Response includes the extracted tier, confidence, 14-dimension scores, the
selected slot, and fallback chain.

### Useful endpoints

| Endpoint | Auth | Purpose |
| --- | :---: | --- |
| `GET /health` | no | Liveness check |
| `GET /health/ready` | no | Slot configuration check |
| `GET /v1/models` | key | Available routing profiles and slots |
| `POST /v1/chat/completions` | key | OpenAI-compatible chat |
| `POST /v1/messages` | key | Anthropic-compatible messages |
| `POST /debug/route` | no (local) | Inspect routing without calling upstream |
| `GET /admin/dashboard` | admin | Management dashboard (HTML) |
| `GET /admin/overview` | admin | Usage overview (JSON) |
| `GET /api/usage/logs` | admin | Query usage logs |
| `GET /api/usage/summary` | admin | Per-user / per-model usage summary |

## Agent Integration

MiniRouter works as a drop-in API proxy for any LLM-powered coding agent. Point
the agent's base URL to MiniRouter and use a routing profile as the model name.

### Claude Code

Claude Code speaks the native Anthropic Messages API. Point it at MiniRouter's
`/v1/messages` endpoint:

```bash
export ANTHROPIC_BASE_URL="http://localhost:8402/v1/messages"
export ANTHROPIC_API_KEY="mr_sk_your_key"
claude
```

All Claude Code features (tool use, streaming, extended thinking) pass through
transparently. Set a routing profile to control which slot gets used:

```bash
# Force the strong slot for all sessions
claude --model minirouter/premium

# Or for a single prompt
claude -p "Optimise this React component" --model minirouter/auto
```

### Codex CLI

OpenAI Codex CLI uses the OpenAI Chat Completions API. Set the base URL and model:

```bash
export OPENAI_BASE_URL="http://localhost:8402/v1"
export OPENAI_API_KEY="mr_sk_your_key"
codex --model minirouter/auto
```

Tool calling, streaming, and reasoning all work without modification. The
router automatically detects function calls and routes them to tool-capable
slots.

### OpenCode

OpenCode is an OpenAI-compatible coding agent. Same pattern:

```bash
export OPENAI_BASE_URL="http://localhost:8402/v1"
export OPENAI_API_KEY="mr_sk_your_key"
opencode --model minirouter/auto
```

### Pi (coding agent harness)

Pi supports both OpenAI and Anthropic backends. For OpenAI-compatible:

```bash
export OPENAI_BASE_URL="http://localhost:8402/v1"
export OPENAI_API_KEY="mr_sk_your_key"
pi --model minirouter/auto
```

For Anthropic-compatible:

```bash
export ANTHROPIC_BASE_URL="http://localhost:8402/v1/messages"
export ANTHROPIC_API_KEY="mr_sk_your_key"
pi --model minirouter/auto
```

### Aider

```bash
aider --openai-api-base http://localhost:8402/v1 \
      --model openai/minirouter/auto \
      --api-key mr_sk_your_key
```

Or via environment:

```bash
export OPENAI_API_BASE="http://localhost:8402/v1"
export OPENAI_API_KEY="mr_sk_your_key"
aider --model openai/minirouter/auto
```

### Cursor / VS Code

In Cursor or VS Code settings, add a custom OpenAI-compatible provider:

```json
{
  "cursor.apiKey": "mr_sk_your_key",
  "cursor.openaiBaseUrl": "http://localhost:8402/v1",
  "cursor.models": ["minirouter/auto", "minirouter/premium"]
}
```

### Any OpenAI-compatible client

Any tool that lets you set a custom OpenAI endpoint works:

```bash
export OPENAI_BASE_URL="http://localhost:8402/v1"
export OPENAI_API_KEY="mr_sk_your_key"
export OPENAI_MODEL="minirouter/auto"
```

### Profile tips for coding agents

| Agent use case | Recommended profile | Why |
| --- | --- | --- |
| Chat / questions | `minirouter/auto` | Let the router decide |
| Code generation | `minirouter/auto` | Auto-detects complexity |
| Heavy refactoring | `minirouter/premium` | Forces the strong slot |
| Quick edits / autocomplete | `minirouter/eco` | Fast, cheap model |
| Image / screenshot tasks | `minirouter/slot/vision` | Vision-capable model |

> **Note:** When using `MINIROUTER_SOLO=true` (local development), you can omit
> the API key. The agent will work without authentication.

## Configuration reference

All configuration lives in `.env`. Copy `.env.example` to `.env` and replace
the placeholders.

### Required slots

At least `balanced`, `strong`, and `vision` must be configured for the
`/health/ready` check to pass. `fast` is optional.

| Variable | Description |
| --- | --- |
| `MINIROUTER_{SLOT}_PROVIDER` | `openai-compatible`, `anthropic`, or omit for auto |
| `MINIROUTER_{SLOT}_BASE_URL` | Upstream API endpoint |
| `MINIROUTER_{SLOT}_API_KEY` | Provider authentication key |
| `MINIROUTER_{SLOT}_MODEL` | Model name the upstream expects |
| `MINIROUTER_{SLOT}_SUPPORTS_TOOLS` | `true` / `false` |
| `MINIROUTER_{SLOT}_SUPPORTS_VISION` | `true` / `false` |
| `MINIROUTER_{SLOT}_CONTEXT_WINDOW` | Maximum context length in tokens |

### Routing tuning (optional — sensible defaults are built in)

These parameters control **how many requests land in each tier**, which directly
determines the balance between cost savings and quality:

```
Tier mapping:  SIMPLE → FAST slot    MEDIUM → BALANCED    COMPLEX/REASONING → STRONG
```

**Key parameters that affect the SIMPLE / MEDIUM / COMPLEX / REASONING split:**

- **Three tier boundaries** (`BOUNDARY_*`) — the most direct control. Move them
  left/right to shift the proportion of requests in each tier.
- **Confidence threshold** — higher = more requests fall through to the ambiguous
  fallback tier (safe but more expensive).
- **Token count thresholds** — longer prompts are nudged up a tier; shorter ones down.

| Variable | Default | What it controls | Effect when you raise the value |
| --- | :---: | --- | --- |
| `BOUNDARY_SIMPLE_MEDIUM` | `0.10` | Score threshold between SIMPLE and MEDIUM | **↑ More requests → SIMPLE (cheaper)**. Fewer tasks get upgraded to MEDIUM. |
| `BOUNDARY_MEDIUM_COMPLEX` | `0.3` | Score threshold between MEDIUM and COMPLEX | **↑ More requests → MEDIUM (balanced)**. Fewer reach the expensive COMPLEX tier. |
| `BOUNDARY_COMPLEX_REASONING` | `0.5` | Score threshold between COMPLEX and REASONING | **↑ More requests → COMPLEX (strong)**. Only the hardest tasks reach REASONING. |
| `TOKEN_COUNT_SIMPLE` | `50` | Token count ≤ this → nudged toward SIMPLE | Raise to push more short prompts to SIMPLE. |
| `TOKEN_COUNT_COMPLEX` | `500` | Token count ≥ this → nudged toward COMPLEX | Raise to require longer prompts before upgrading. |
| `CONFIDENCE_THRESHOLD` | `0.55` | Below this confidence → fallback to ambiguous tier | **↑ More requests go to ambiguous fallback** (safer, but more expensive). |
| `CONFIDENCE_STEEPNESS` | `12` | Sigmoid sharpness for confidence calibration | Higher = sharper on/off. Rarely needs tuning. |
| `AMBIGUOUS_DEFAULT_TIER` | `MEDIUM` | Fallback tier when confidence is below threshold | `SIMPLE` = max cost savings; `COMPLEX` = err on the safe side. |
| `STRUCTURED_OUTPUT_MIN_TIER` | `SIMPLE` | Minimum tier for JSON mode / tool_choice requests | `SIMPLE` = cheapest; `MEDIUM`/`COMPLEX` = better quality but more expensive. |
| `AGENTIC_SCORE_THRESHOLD` | `0.5` | Agentic dimension score that triggers agentic routing | Higher = harder to trigger agentic mode (more requests stay on standard routing). |
| `AGENTIC_MODE` | — | Force agentic mode: `true` / `false` (omit = auto-detect) | `true` = always use agentic tiers; `false` = disable entirely. |
| `DIMENSION_WEIGHTS` | — | JSON object overriding all 14 dimension weights | Advanced: reshape the entire scoring space. E.g. `{"keywordCount":0.15,"instructionComplexity":0.12}` |

> All variables above are prefixed with `MINIROUTER_` at runtime.
> E.g. `MINIROUTER_BOUNDARY_SIMPLE_MEDIUM=0.10`.

#### Quick tuning guide

| Goal | What to change |
| --- | --- |
| **Save more money** (more requests → SIMPLE/FAST) | Raise `BOUNDARY_SIMPLE_MEDIUM` (e.g. 0.20), lower `CONFIDENCE_THRESHOLD` (e.g. 0.45), set `AMBIGUOUS_DEFAULT_TIER=SIMPLE` |
| **Improve quality** (more requests → STRONG) | Lower `BOUNDARY_MEDIUM_COMPLEX` (e.g. 0.20), lower `BOUNDARY_COMPLEX_REASONING` (e.g. 0.35), raise `CONFIDENCE_THRESHOLD` (e.g. 0.65) |
| **Balanced default** | Keep defaults. Fine-tune `BOUNDARY_SIMPLE_MEDIUM` between 0.05–0.15. |

### Context optimisation (optional — off by default)

| Variable | Default | Description |
| --- | :---: | --- |
| `MINIROUTER_HEADROOM_ENABLED` | `false` | Use external Headroom service |
| `MINIROUTER_HEADROOM_MODE` | `adaptive` | `off` / `adaptive` / `force` |
| `MINIROUTER_HEADROOM_URL` | — | Headroom API endpoint |
| `MINIROUTER_HEADROOM_MIN_TOKENS` | `8000` | Min tokens before invoking Headroom |
| `MINIROUTER_HEADROOM_CONTEXT_RATIO` | `0.85` | Context-fill ratio trigger |
| `MINIROUTER_TAIL_COMPRESSION_ENABLED` | `false` | Local tail compression |
| `MINIROUTER_TAIL_COMPRESSION_MIN_CHARS` | `12000` | Min chars before compressing |
| `MINIROUTER_TAIL_COMPRESSION_MAX_CHARS` | `2000` | Target chars after compression |

### Other

| Variable | Default | Description |
| --- | :---: | --- |
| `MINIROUTER_SOLO` | `true` | Skip API key auth (local development) |
| `MINIROUTER_PORT` | `8402` | HTTP listen port |
| `MINIROUTER_CNY_PER_USD` | `7.2` | Exchange rate for CNY-based cost tracking |
| `MINIROUTER_DEBUG_LOG` | `false` | Print extra diagnostics to stdout |
| `MINIROUTER_DB` | `~/.minirouter/minirouter.db` | Override the SQLite database path |
| `MINIROUTER_USER` | `minirouter` | System user (deploy script only) |
| `MINIROUTER_BRANCH` | `main` | Git branch (deploy script only) |

## Querying the database

MiniRouter stores everything in SQLite at `~/.minirouter/minirouter.db`.

```bash
# Today's dashboard (from the project root)
node scripts/today.mjs

# Interactive queries
export MINIROUTER_DB="$HOME/.minirouter/minirouter.db"
node -e "
  const D=require('better-sqlite3');
  const d=new D(process.env.MINIROUTER_DB,{readonly:true});
  console.table(d.prepare(\`
    SELECT created_at, tier, model, status,
           input_tokens, output_tokens
    FROM usage_logs ORDER BY created_at DESC LIMIT 20
  \`).all())
"
```

See [docs/db-queries.md](docs/db-queries.md) for more query recipes.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
```

## Docs

- [Routing overview & MVP](docs/routing-mvp.md)
- [Routing strategy](docs/routing-strategy.md)
- [Infrastructure management design](docs/infra-management-design.md)
- [Database query guide](docs/db-queries.md)
- [Environment variables](.env.example)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)
