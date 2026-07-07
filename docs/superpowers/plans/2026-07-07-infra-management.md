# Infra Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build lightweight-cloud infra management for MiniRouter: multi-user management, real cost tracking, managed provider channels, and a compact admin dashboard.

**Architecture:** Keep the existing Hono + SQLite service. Extend the current auth/schema/admin-route skeleton, route requests through managed provider channels when present, and serve a static dashboard from the Node process.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, SQLite, Vitest, vanilla HTML/CSS/JavaScript.

---

## File Structure

- Modify `src/db/schema.ts`: extend `provider_instances` and `usage_logs`.
- Modify `src/db/migrations.ts`: idempotently add new provider and usage columns.
- Create `src/db/queries/provider-instances.ts`: CRUD, health, and channel selection helpers.
- Create `src/db/queries/spend.ts`: usage aggregation for daily and monthly spend.
- Create `src/router/cost.ts`: central cost estimator from `model_scores`.
- Modify `src/auth/types.ts` and `src/auth/apikey.ts`: expose key limits and enforce safer scope parsing.
- Modify `src/server/middleware/auth.ts`: keep solo mode but make admin scope rules explicit.
- Modify `src/server/routes/admin.ts`: add users, keys, overview, and channel APIs.
- Modify `src/server/routes/chat.ts`: calculate real cost and use managed channels.
- Modify `src/server/routes/anthropic-messages.ts`: mirror chat route cost/channel behavior.
- Create `src/server/routes/admin-dashboard.ts`: serve static admin UI.
- Create `admin/dashboard.html`: lightweight visual management console.
- Modify `src/server/app.ts`: wire new APIs and dashboard route.
- Add or update Vitest files near the touched modules.
- Modify `docs/minirouter-env.example`: document production auth, cost, and managed channels.

## Task 1: Auth Scope And User Management Base

**Files:**
- Modify: `src/auth/types.ts`
- Modify: `src/auth/apikey.ts`
- Modify: `src/db/queries/users.ts`
- Modify: `src/server/routes/admin.ts`
- Test: `src/auth/apikey.test.ts` or nearby auth/admin route tests

- [ ] Add `rateLimitRpm`, `spendLimitDailyUsd`, `spendLimitMonthlyUsd`, and key override fields to `AuthResult`.
- [ ] Parse key scopes defensively. Invalid JSON should fail auth with a 401 error instead of throwing a server error.
- [ ] Add user update query for role, active status, routing profile, and spend limits.
- [ ] Require both admin role and `manage` scope for `/admin/*` routes.
- [ ] Add tests for manage-scope requirement and invalid scope JSON.

## Task 2: Cost Estimation And Spend Queries

**Files:**
- Create: `src/router/cost.ts`
- Create: `src/router/cost.test.ts`
- Create: `src/db/queries/spend.ts`
- Modify: `src/server/routes/chat.ts`
- Modify: `src/server/routes/anthropic-messages.ts`

- [ ] Implement `estimateUsdCost(model, usage, env)` using `model_scores` prices and `MINIROUTER_CNY_PER_USD`.
- [ ] Return zero cost when model pricing is missing, but include a clear `pricing_missing` marker for future logs.
- [ ] Add daily and monthly spend aggregation by user and API key.
- [ ] Add spend-limit preflight before upstream calls.
- [ ] Replace `costUsd: 0` usage writes with estimated costs after usage parsing.
- [ ] Add tests for CNY to USD conversion and missing-price fallback.

## Task 3: Managed Provider Channels

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/migrations.ts`
- Create: `src/db/queries/provider-instances.ts`
- Create: `src/providers/channels.ts`
- Create: `src/providers/channels.test.ts`
- Modify: `src/providers/types.ts`

- [ ] Extend `provider_instances` with slot, provider kind, API key, model capabilities, cooldown, updated timestamp, and notes.
- [ ] Implement provider channel CRUD queries.
- [ ] Implement weighted round-robin channel selection with capability filters.
- [ ] Implement failure recording and cooldown.
- [ ] Keep env slots as fallback when no managed channel exists.
- [ ] Add tests for weighted selection, capability filtering, and fallback behavior.

## Task 4: Wire Channels Into Inference Routes

**Files:**
- Modify: `src/server/routes/chat.ts`
- Modify: `src/server/routes/anthropic-messages.ts`
- Modify: `src/providers/openai-compatible.ts`
- Modify: `src/providers/anthropic.ts`
- Test: route/provider tests near existing files

- [ ] Select the MiniRouter slot as today, then resolve a managed channel for that slot.
- [ ] Use the managed channel credentials and model when present.
- [ ] Retry one alternate healthy channel on network or 5xx upstream failure.
- [ ] Record `provider_instance_id` on usage logs.
- [ ] Record channel health metrics after success or failure.
- [ ] Add route tests using fake fetch responses.

## Task 5: Admin APIs

**Files:**
- Modify: `src/server/routes/admin.ts`
- Modify: `src/server/app.ts`
- Test: `src/server/app.test.ts` or new `src/server/routes/admin.test.ts`

- [ ] Add `GET /admin/overview`.
- [ ] Add `POST /admin/users`.
- [ ] Add `PATCH /admin/users/:id`.
- [ ] Add `GET /admin/users/:id/keys`.
- [ ] Add `POST /admin/users/:id/keys`.
- [ ] Add `GET /admin/channels`.
- [ ] Add `POST /admin/channels`.
- [ ] Add `PATCH /admin/channels/:id`.
- [ ] Add `DELETE /admin/channels/:id`.
- [ ] Add tests for admin-only access and basic JSON shapes.

## Task 6: Static Admin Dashboard

**Files:**
- Create: `admin/dashboard.html`
- Create: `src/server/routes/admin-dashboard.ts`
- Modify: `src/server/app.ts`

- [ ] Serve `/admin/dashboard` as an authenticated admin page.
- [ ] Build overview cards, users table, key creation form, channels table, and recent usage table.
- [ ] Use Bearer token input stored in session storage.
- [ ] Keep styling dense and operational.
- [ ] Add a smoke test that the dashboard route returns HTML.

## Task 7: Docs And Verification

**Files:**
- Modify: `docs/minirouter-env.example`
- Modify: `README.md` if needed

- [ ] Document production auth: set `MINIROUTER_SOLO=false`.
- [ ] Document `MINIROUTER_CNY_PER_USD`.
- [ ] Document env-slot fallback versus DB-managed channels.
- [ ] Run `npm run typecheck`.
- [ ] Run targeted Vitest files.
- [ ] Run `npm test` if targeted tests pass quickly.

