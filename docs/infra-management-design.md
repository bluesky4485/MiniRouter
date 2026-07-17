# MiniRouter Infra Management Design

MiniRouter will run first as a lightweight Node service on a small cloud host. This design intentionally avoids Cloudflare Worker and D1-specific constraints. The first production target is one Node process, SQLite, Hono APIs, and a small static management console served by the same process.

## Goals

- Give each caller its own API key and user identity.
- Track actual usage and estimated spend by user, API key, model, and provider channel.
- Enforce simple rate and spend limits before forwarding expensive requests.
- Support multiple upstream LLM channels per MiniRouter slot for load balancing and failover.
- Provide a compact web UI for usage visibility, key management, user management, and channel health.

## Non-Goals

- No Cloudflare Worker or D1 adapter in this phase.
- No full SaaS billing, payments, invoices, or multi-tenant organization workflows.
- No large frontend framework. The console should remain static HTML, CSS, and vanilla JavaScript unless the UI becomes too complex.
- No provider marketplace. Channels are operator-managed endpoints with stored credentials.

## Runtime Shape

```text
Client / Agent
  -> Authorization: Bearer mr_sk_...
  -> MiniRouter Hono server
      -> auth + scope check
      -> rate/spend preflight
      -> routing tier/profile decision
      -> slot selection
      -> channel selection within the slot
      -> upstream LLM request
      -> usage + cost + channel result log
  -> OpenAI-compatible or Anthropic-compatible response
```

The existing environment-slot path remains as a compatibility fallback, but the managed channel path becomes the preferred production mode once channels exist in SQLite.

## Data Model

Existing tables already cover most of the base:

- `users`: account identity, role, routing defaults, rate limits, spend limits.
- `api_keys`: hashed keys, scopes, labels, key-level overrides.
- `usage_logs`: per-request usage and cost ledger.
- `provider_instances`: upstream endpoints for load balancing.
- `model_scores`: model pricing and capability metadata.

The first implementation should extend rather than replace this model:

- Add `slot`, `provider_kind`, `api_key`, `supports_tools`, `supports_vision`, `context_window_tokens`, `cooldown_until`, `updated_at`, and optional `notes` to `provider_instances`.
- Add optional `pricing_model_id` to `provider_instances` so the upstream model name can differ from the canonical `model_scores.id` used for cost accounting.
- Add `provider_instance_id` to `usage_logs` so spend and reliability can be attributed to an upstream channel.
- Keep encrypted provider keys out of scope for the first local deployment if the SQLite file is protected at the host level; store credentials in the table so the admin UI can manage channels. A later hardening pass can add AES-GCM at-rest encryption.

## Auth And Scopes

MiniRouter should separate inference credentials from management credentials:

- `chat`: can call `/v1/chat/completions` and `/v1/messages`.
- `models`: can call `/v1/models`.
- `usage`: can read its own `/api/usage/*`.
- `manage`: can access `/admin/*`, create users and keys, and manage provider channels.

Admin routes require either:

- a user role of `admin` or `superadmin`, and
- a key with `manage` scope.

`MINIROUTER_SOLO=true` remains useful for local development, but production docs should recommend turning it off.

## Cost Governance

Every successful and failed upstream attempt should write enough data to explain spend and failures.

Cost calculation should use `model_scores` when possible:

```text
cost_usd =
  (input_tokens - cache_read_tokens) / 1_000_000 * input_price_usd_per_million +
  cache_read_tokens / 1_000_000 * cache_hit_price_usd_per_million +
  output_tokens / 1_000_000 * output_price_usd_per_million
```

The current model registry stores prices in CNY per million tokens. The implementation should centralize conversion with a configurable rate, defaulting to `MINIROUTER_CNY_PER_USD=7.2`.

Spend preflight is conservative:

- If daily or monthly spend is already over the configured limit, reject before forwarding.
- If token usage is not known before the request, do not attempt exact future-cost prediction in v1.
- After response parsing, log actual estimated cost.

## Provider Channels

A provider channel is one concrete upstream endpoint:

```text
slot=balanced
provider=deepseek-primary
provider_kind=openai-compatible | anthropic | auto

**Protocol compatibility rule:**
- A channel/slot with `provider_kind=openai-compatible` will **never** be selected for Anthropic Messages requests.
- A channel/slot with `provider_kind=anthropic` will **never** be selected for OpenAI Chat Completions requests.
- `auto` (default) adapts to the incoming protocol (OpenAI requests → /chat/completions, Anthropic → /messages).
- Selection happens in `pickSlotForFeatures` (env slots) and `selectProviderChannel` (DB channels), and is enforced before calling the executor.
base_url=https://api.example.com/v1
api_key=...
model=deepseek-v4-flash
pricing_model_id=deepseek/v4-flash
weight=2
supports_tools=true
supports_vision=false
is_healthy=true
```

`model` is the upstream model name sent to the provider. `pricing_model_id`
is the canonical `model_scores.id` used for cost accounting. Leave it empty
to use the built-in alias map plus `MINIROUTER_PRICE_MODEL_ALIASES` JSON
overrides.

Initial selection policy:

1. Load healthy, active channels for the selected slot.
2. Filter by capability requirements such as tool calling and vision.
3. Prefer channels outside cooldown.
4. Pick by weighted round-robin using a small in-memory cursor.
5. On upstream error, mark one failure and retry another eligible channel once.
6. After repeated failures, set `is_healthy=0` or `cooldown_until` so traffic drains away.

The existing env-slot configuration remains the fallback when no DB channels exist.

## Admin API

Add or complete the following endpoints:

- `GET /admin/overview`: platform totals, today/month spend, requests, error rate.
- `GET /admin/users`: list users with spend and key counts.
- `POST /admin/users`: create user with role, routing defaults, limits.
- `PATCH /admin/users/:id`: update status, role, limits, routing profile.
- `GET /admin/users/:id/keys`: list key metadata without secret material.
- `POST /admin/users/:id/keys`: create a key and show it once.
- `DELETE /admin/keys/:id`: revoke a key.
- `GET /admin/channels`: list provider channels with health and usage.
- `POST /admin/channels`: create channel.
- `PATCH /admin/channels/:id`: update channel settings and health.
- `DELETE /admin/channels/:id`: disable or delete channel.

## Admin Console

Serve a static page at `/admin/dashboard`. The first screen should be the usable dashboard, not a marketing page.

Sections:

- Overview cards: requests, spend today, spend month, errors, active users.
- Usage table: recent requests with user, key prefix, model, channel, status, tokens, cost, latency.
- Users table: email, role, active status, routing profile, spend limits, key count.
- User detail drawer or inline panel: create/revoke keys and edit limits.
- Channels table: slot, provider, model, weight, healthy status, failures, average latency, last used.
- Channel form: create or update upstream endpoint configuration.

The UI can follow the existing `admin/dashboard.html` style, but should fix encoding and use concise Chinese labels.

## Rollout Plan

1. Add docs and implementation plan.
2. Harden auth scopes and admin access.
3. Add real cost calculation and spend summaries.
4. Add managed provider channel queries and selector.
5. Wire chat and messages routes through managed channels when available.
6. Build the static admin console.
7. Run typecheck and targeted tests.
