# MiniRouter Design

> Historical design and roadmap notes. For current runtime behavior, use the
> root README plus `docs/routing-mvp.md` and `docs/routing-strategy.md`; those
> documents take precedence when this file conflicts with the implementation.

MiniRouter is an Agent-oriented LLM routing gateway. Its job is not only to rank
models, but to decide which model can satisfy a request at the best cost-quality
point, then execute it with an explainable fallback plan.

## Product Positioning

MiniRouter serves three connected needs:

1. Maintain a real model catalog: pricing, capability, benchmark scores,
   modality support, context window, tool support, and health.
2. Route each request automatically: detect task type and hard capability
   requirements, then pick the best value model.
3. Learn from production telemetry: route receipts, failures, latency, cost,
   retries, and user overrides.

The first target scenario is Agent usage, including Claude Code, Codex, OpenAI
SDK-compatible tools, Anthropic SDK-compatible tools, and domestic model
gateways. Agent workloads make tool calling, long context, fallback stability,
and session consistency more important than simple chat quality.

## Core Principle

Routing must be constraint-first:

```txt
Can the model satisfy the request?
  -> If no, filter it out.

Among capable models, which one is best value?
  -> Rank by ability, reliability, latency, cost, and policy preference.
```

Price is not a hard substitute for capability. A cheap text-only model must not
compete for an image request. A model without stable tool calling must not be
selected for Agent tool loops unless the policy explicitly allows that risk.

## Architecture

MiniRouter is split into three planes.

```txt
Control Plane
  Model catalog, benchmark data, pricing, provider instances, policy config.

Data Plane
  Per-request parsing, feature extraction, routing, fallback, provider execution.

Learning Plane
  Telemetry, route receipts, feedback, score calibration, learned routers.
```

The MVP focuses on the Control Plane model database and the Data Plane routing
core. The Learning Plane should remain telemetry-first until enough real traffic
exists.

## Request Flow

```txt
Client request
  -> Protocol adapter
  -> Canonical Request IR
  -> Feature extractor
  -> Capability gate
  -> Task classifier
  -> Policy engine
  -> Model selector
  -> Provider adapter
  -> Telemetry and route receipt
```

### Protocol Adapter

The routing core should not depend on OpenAI or Anthropic raw request shapes for
classification. Each input protocol is normalized into a canonical internal
representation for feature extraction only.

The proxy path must preserve native API semantics. MiniRouter should not rewrite
an OpenAI Chat request into Anthropic Messages by default, or rewrite Anthropic
Messages into OpenAI Chat. Native request bodies, provider-specific parameters,
streaming semantics, and tool-call formats should pass through the matching
native endpoint.

Initial protocols:

- OpenAI Chat Completions
- Anthropic Messages
- OpenAI Responses

The MVP implements OpenAI Chat and Anthropic Messages as separate native
ingress endpoints.

### Canonical Request IR

The internal request shape captures:

- protocol
- requested model or routing profile
- messages and content blocks
- text, image, audio, and video inputs
- tools and tool choice
- structured output or JSON mode
- max output tokens
- stream flag

This lets one routing pipeline serve many clients.

### Feature Extractor

The feature extractor identifies:

- estimated input and total token count
- vision, audio, and video requirements
- tool calling requirement
- JSON or structured output requirement
- long-context requirement
- agentic workload signals
- prompt text for rule-based task classification

### Capability Gate

The capability gate performs hard filtering before scoring:

- inactive model
- vision required but unsupported
- audio or video required but unsupported
- tools required but unsupported
- JSON mode required but unsupported
- context window too small
- max output too small

Filtered models should be returned in the route receipt with exact reasons.

### Task Classifier

The existing rule classifier remains useful for MVP. It maps requests into:

- SIMPLE
- MEDIUM
- COMPLEX
- REASONING

For Agent workloads, routing should also consider capability profiles:

- AGENTIC_SIMPLE
- AGENTIC_CODE
- AGENTIC_REASONING
- AGENTIC_VISION

The MVP starts with feature extraction plus existing rule routing. Learned
classification can come later.

### Policy Engine

Policy decides which candidate pool and ranking weights apply.

Suggested profiles:

- eco: aggressive cost optimization
- auto: balanced cost-quality routing
- premium: quality and reliability first

Future subscription tiers can map onto these profiles, but the internal routing
engine should stay profile-based.

### Model Selector

After hard filtering, the selector ranks eligible models by value.

Initial score:

```txt
route_score =
  ability_score * ability_weight
  + cost_score * cost_weight
  + speed_score * speed_weight
  + reliability_score * reliability_weight
  + priority_score * priority_weight
```

Weights vary by profile:

- eco raises cost weight
- premium raises ability and reliability weight
- auto keeps a balanced mix

The selector returns:

- selected primary model
- ordered fallback chain
- estimated cost
- route score
- filtered-out reasons

## MVP Scope

The first MVP should make routing explainable before making execution complex.

Implemented or planned in this slice:

1. Canonical Request IR for OpenAI Chat.
2. Feature extraction for tools, vision, JSON mode, context, and Agent signals.
3. Database-backed catalog mapping from `model_scores`.
4. `POST /debug/route` to inspect model selection and fallback.
5. `.env`-driven model slots for real OpenAI-compatible and Anthropic-native
   calls.

Out of scope for the first slice:

- learned routing
- automatic score calibration
- billing

## `/debug/route`

This endpoint is the main MVP inspection tool.

Request example:

```json
{
  "model": "minirouter/auto",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Analyze this screenshot and return JSON." },
        { "type": "image_url", "image_url": { "url": "https://example.com/ui.png" } }
      ]
    }
  ],
  "tools": [
    { "type": "function", "function": { "name": "save_result" } }
  ],
  "response_format": { "type": "json_object" },
  "max_tokens": 2048
}
```

Response should include:

- extracted features
- selected model
- fallback chain
- filtered models and reasons
- model count
- profile

This endpoint is intentionally public in the local MVP so routing behavior can
be debugged from the dashboard and development tools.

## Real Routing MVP

The first runnable gateway path uses environment-configured model slots instead
of the model-score database. This keeps model data maintenance separate from the
core routing/proxy work.

Supported slots:

- `FAST`: optional — reserved for later local/cheap routing. Does NOT participate
  in auto-routing (simple requests fall back to BALANCED). Only callable via
  explicit `minirouter/slot/fast`.
- `BALANCED`: default workhorse for code, tools, and normal Agent steps.
  Initial model: DeepSeek V4 Flash.
- `STRONG`: complex reasoning, hard coding, planning, and multi-step
  debugging. Initial model: GLM-5.2.
- `VISION`: screenshots, images, and multimodal tasks. Initial model:
  GLM-4.6V (or equivalent vision-capable model).

Each slot is configured with:

```txt
MINIROUTER_<SLOT>_BASE_URL=https://...
MINIROUTER_<SLOT>_API_KEY=...
MINIROUTER_<SLOT>_MODEL=...
MINIROUTER_<SLOT>_SUPPORTS_TOOLS=true | false
MINIROUTER_<SLOT>_SUPPORTS_VISION=true | false
MINIROUTER_<SLOT>_PROVIDER=openai-compatible | anthropic | (omit for auto)
MINIROUTER_<SLOT>_CONTEXT_WINDOW=1048576
```

`MINIROUTER_<SLOT>_PROVIDER` is optional. The default is `auto`, which means the
protocol is selected from the incoming API shape. OpenAI Chat requests are sent
to `{BASE_URL}/chat/completions`; Anthropic Messages requests are sent to
`{BASE_URL}/messages`. Set `PROVIDER=anthropic` only when a slot must always use
the native Anthropic Messages API.

**Important compatibility rule (enforced at selection time):**
- OpenAI-compatible channels/slots are never selected for Anthropic Messages requests.
- Anthropic channels/slots are never selected for OpenAI Chat requests.
- "auto" adapts to the request protocol.
- This prevents protocol mismatch errors when mixing provider types in the same slot (especially with admin-managed channels).

Upstream fetch timeout defaults to 180s and is configurable via
`MINIROUTER_UPSTREAM_TIMEOUT_MS`.

### 14-Dimension Rule Classifier

The core of MiniRouter's auto-routing is a zero-cost rule-based classifier
(~1ms, no external API calls). It scores the **user prompt only** (system
prompts are excluded to avoid tool-definition keywords dominating the score)
across 14 weighted dimensions, then maps the aggregate score to a tier.

Each dimension returns a score in [-1, 1] based on keyword matches against
multilingual keyword lists (EN, ZH, JA, RU, DE, ES, PT, KO, AR).

| Dimension | Weight | What It Detects |
|---|---|---|
| tokenCount | 0.08 | Short (<50 tokens) vs long (>500 tokens) context |
| codePresence | 0.15 | Programming keywords: `function`, `class`, `def`, `函数`, etc. |
| reasoningMarkers | 0.18 | Logic/proof keywords: `prove`, `step by step`, `证明`, `逐步`, etc. |
| technicalTerms | 0.10 | Architecture/infra: `algorithm`, `分布式`, `kubernetes`, etc. |
| creativeMarkers | 0.05 | Creative writing: `story`, `诗`, `imagine`, `brainstorm`, etc. |
| simpleIndicators | 0.02 | Simple queries: `what is`, `什么是`, `翻译`, `hello`, etc. |
| multiStepPatterns | 0.12 | Multi-step patterns: `first.*then`, `step \d`, numbered lists |
| questionComplexity | 0.05 | Number of question marks (>3 = complex) |
| imperativeVerbs | 0.03 | Action verbs: `build`, `创建`, `deploy`, `配置`, etc. |
| constraintCount | 0.04 | Constraints: `at most`, `不超过`, `maximum`, `budget`, etc. |
| outputFormat | 0.03 | Format requirements: `json`, `表格`, `schema`, `csv`, etc. |
| referenceComplexity | 0.02 | Cross-references: `above`, `上面`, `the docs`, `附件`, etc. |
| negationComplexity | 0.01 | Negation: `don't`, `不要`, `never`, `avoid`, etc. |
| agenticTask | 0.04 | Agent signals: `edit`, `fix`, `debug`, `修改`, `调试`, etc. |

**Score → Tier mapping (weighted sum):**

| Tier | Score Range | Example Requests |
|---|---|---|
| SIMPLE | < 0.0 | "what is photosynthesis", "translate to French" |
| MEDIUM | 0.0 ~ 0.3 | "write a React component", "explain this algorithm" |
| COMPLEX | 0.3 ~ 0.5 | "design a microservice architecture", "refactor this codebase" |
| REASONING | > 0.5 | "prove this theorem step by step", "formal verification" |

**Hard overrides (bypass scoring):**

- 2+ reasoning keywords → REASONING (regardless of aggregate score)
- >100k estimated tokens → COMPLEX (large context forces capability)
- Structured output detected → minimum MEDIUM tier

**Confidence calibration:** Sigmoid function maps distance from tier boundary to
[0.5, 1.0] confidence. Below 0.7 → ambiguous → falls back to MEDIUM.

### Agentic Mode Detection

When tools are present in the request OR the agentic dimension score is ≥ 0.5,
the router switches to `agenticTiers` (a separate tier config optimized for
multi-step autonomous tasks with strong tool-calling support). In the MVP
env-slot path, this translates to routing agentic requests to at least
`BALANCED` (for SIMPLE/MEDIUM tier) or `STRONG` (for COMPLEX/REASONING tier).

### Tier → Slot Mapping

```
vision request → VISION slot (always, regardless of tier)

toolCalling / agentic + SIMPLE/MEDIUM → BALANCED
toolCalling / agentic + COMPLEX/REASONING → STRONG

SIMPLE (no tool/vision) → BALANCED (FAST is reserved, does not participate)
MEDIUM → BALANCED
COMPLEX → STRONG
REASONING → STRONG
```

| Tier | No tool/vision | Has tool | Has vision |
|---|---|---|---|
| SIMPLE | BALANCED | BALANCED | VISION |
| MEDIUM | BALANCED | BALANCED | VISION |
| COMPLEX | STRONG | STRONG | VISION |
| REASONING | STRONG | STRONG | VISION |

### Explicit Slot Override

Users can bypass auto-routing by specifying `minirouter/slot/balanced`,
`minirouter/slot/strong`, `minirouter/slot/vision`, or `minirouter/slot/fast`.
The router skips classification and uses the requested slot directly (after
checking vision/tool capability gates).

### Routing Flow Summary

```txt
1. Accept OpenAI Chat (/v1/chat/completions) or Anthropic Messages (/v1/messages)
2. Normalize → CanonicalRequest (protocol-agnostic IR)
3. Extract features: vision, tools, agentic, JSON mode, long context
4. Explicit slot request? → skip to step 7 if yes
5. 14-dimension classifier → SIMPLE/MEDIUM/COMPLEX/REASONING
6. Pick slot:
   vision → VISION
   tool/agentic + SIMPLE/MEDIUM → BALANCED
   tool/agentic + COMPLEX/REASONING → STRONG
   SIMPLE/MEDIUM → BALANCED
   COMPLEX/REASONING → STRONG
7. Context Headroom optimization (optional, default: pass-through)
8. Forward to upstream with model override + 180s timeout
9. Parse usage (non-streaming: prompt_tokens/completion_tokens)
10. Write to SQLite usage_logs + return upstream response
```

If no slots are configured, both `/v1/chat/completions` and `/v1/messages`
return an explicit 503 configuration error. MiniRouter should not return a fake
successful chat completion when no upstream model is configured.

For the first execution MVP, configure only these required slots:

```txt
BALANCED = DeepSeek V4 Flash
STRONG   = GLM-5.2
VISION   = GLM-4.6V (or equivalent vision-capable model)
```

`FAST = GLM-4.7-Flash` can be added after the proxy path, logging, and fallback
behavior are stable.

## Context Optimization

MiniRouter reserves a Headroom-compatible context optimization layer between
routing and provider execution.

Default behavior is pass-through:

```txt
MINIROUTER_HEADROOM_ENABLED=false
MINIROUTER_HEADROOM_MODE=off
MINIROUTER_TAIL_COMPRESSION_ENABLED=false
```

When enabled, Headroom is controlled by:

```txt
MINIROUTER_HEADROOM_MODE=off | adaptive | force
MINIROUTER_HEADROOM_URL=http://localhost:8787
MINIROUTER_HEADROOM_MIN_TOKENS=8000
MINIROUTER_HEADROOM_CONTEXT_RATIO=0.85
```

Policy:

```txt
off:
  pass through unchanged

adaptive:
  short requests pass through unchanged
  long tool/log/RAG/file payloads can be sent to Headroom
  requests near the selected slot context window can be sent to Headroom
  static prefix should be protected to preserve provider cache hits

force:
  every routed request is sent to Headroom for experiments and pressure tests
```

MiniRouter sends Headroom the native protocol name, original body, selected
slot, and policy hints such as `protectStaticPrefix` and
`preserveNativeApiShape`. Headroom should return the same API shape with an
optimized body. If Headroom is disabled, unavailable, or returns an error,
MiniRouter uses the original body.

Important MVP note: MiniRouter's current integration expects a local
`POST /optimize` service. Official `headroom proxy --port 8787` exposes LLM
proxy endpoints (`/v1/messages`, `/v1/chat/completions`, etc.), not MiniRouter's
`/optimize` contract. Keep MiniRouter compression disabled while validating the
routing gateway. `start-headroom.bat` can start the official Headroom proxy for
experiments, but a small adapter layer is still required before flipping
`MINIROUTER_HEADROOM_ENABLED=true` in production routing.

For cache-sensitive Agent traffic, prefer Headroom `--mode cache` once the
adapter exists. This protects prior turns and static prefixes so provider
prefix-cache hit rate is not destroyed by unnecessary rewrites.

## External Design References

MiniRouter should borrow selectively:

- RouteLLM: threshold-based strong/weak routing after enough preference data.
- LiteLLM: production gateway reliability, fallback, retry, timeout, cooldown.
- OpenRouter: provider routing, model/provider constraints, session consistency.
- Agent routing papers: route receipts, feedback loops, and agentic context.

Cold-start MiniRouter should not depend on learned routing. It should first be
correct, observable, and stable.

## Development Roadmap

### Phase 1: Explainable Router MVP ✅ Done

- [x] OpenAI Chat + Anthropic Messages canonical request normalization
- [x] feature extraction (tools, vision, JSON, context, agentic)
- [x] DB-backed candidate loading from model_scores table
- [x] capability gate (8 hard filters)
- [x] `/debug/route` (env-slot and DB modes)
- [x] 14-dimension rule classifier (~1ms, zero-cost)
- [x] unit tests for request normalization and route selection

### Phase 2: Real Gateway Execution ✅ Done

- [x] OpenAI-compatible provider adapter
- [x] Anthropic Messages adapter
- [x] ENV-driven model slots (fast/balanced/strong/vision)
- [x] upstream fetch timeout (180s default)
- [x] non-streaming usage parsing (prompt/completion/cache_read tokens)
- [x] usage log query APIs (GET /api/usage/logs, GET /api/usage/summary)
- [x] auto-migration + solo user bootstrap on startup
- [x] Context Headroom optimization layer
- [x] structured error responses (503 configuration, 502 provider)
- [ ] streaming usage parsing (SSE last-event extraction)
- [ ] fallback retry (slot failure → next slot)

### Phase 3: Agent Reliability (planned)

- session sticky model selection
- tool-call stability metrics
- route receipt storage
- provider health checks
- per-user and per-team policy overrides

### Phase 4: Data-Driven Routing (planned)

- collect route outcomes
- analyze retries and user overrides
- calibrate model scores from production
- add RouteLLM-style threshold routing for well-observed tasks
