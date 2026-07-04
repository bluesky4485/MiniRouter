# MiniRouter Routing MVP

This MVP runs the router as a local OpenAI-compatible gateway with optional
Anthropic Messages ingress.

## Required Env Slots

Configure these three slots in `.env`:

```env
MINIROUTER_SOLO=true
BLOCKRUN_PROXY_PORT=8402

MINIROUTER_BALANCED_BASE_URL=https://...
MINIROUTER_BALANCED_API_KEY=...
MINIROUTER_BALANCED_MODEL=...
MINIROUTER_BALANCED_SUPPORTS_TOOLS=true
MINIROUTER_BALANCED_SUPPORTS_VISION=false

MINIROUTER_STRONG_BASE_URL=https://...
MINIROUTER_STRONG_API_KEY=...
MINIROUTER_STRONG_MODEL=...
MINIROUTER_STRONG_SUPPORTS_TOOLS=true
MINIROUTER_STRONG_SUPPORTS_VISION=false

MINIROUTER_VISION_BASE_URL=https://...
MINIROUTER_VISION_API_KEY=...
MINIROUTER_VISION_MODEL=...
MINIROUTER_VISION_PROVIDER=openai-compatible
MINIROUTER_VISION_SUPPORTS_TOOLS=false
MINIROUTER_VISION_SUPPORTS_VISION=true
```

For MiniCPM-V-4.6-Thinking on vLLM, configure `VISION_PROVIDER=openai-compatible`.
MiniRouter will keep Anthropic Messages ingress for clients such as Claude Code,
then adapt only the selected VISION request to the model's OpenAI-compatible
upstream shape.

Recommended vLLM launch shape for visual understanding:

```bash
VLLM_USE_MODELSCOPE=true vllm serve openbmb/MiniCPM-V-4.6-Thinking \
  --host 0.0.0.0 \
  --port 8000 \
  --default-chat-template-kwargs '{"enable_thinking": true}'
```

MiniCPM-V official examples include a tool-calling demo, but the documented
fallback may emit a `<tool_call>` block inside `content` rather than OpenAI
structured `tool_calls`. For Agent clients such as Codex and Claude Code, keep
`MINIROUTER_VISION_SUPPORTS_TOOLS=false` until the exact serving stack has
verified structured tool parsing.

For native performance, keep `MINIROUTER_VISION_CONTEXT_WINDOW` aligned with
the upstream vLLM `--max-model-len`. If the server is launched with a larger
context window, raise the env value too. MiniRouter should not enable Headroom
for this slot.

`FAST` is optional. Leave it unset until a cheap local or hosted fast model is
ready. Simple requests fall back to `BALANCED`.

## Start

```powershell
npm.cmd run serve
```

## Check Readiness

```powershell
Invoke-RestMethod http://localhost:8402/health/ready
```

Ready means `balanced`, `strong`, and `vision` are configured. `fast` should
appear as optional.

## Inspect Routing

```powershell
Invoke-RestMethod http://localhost:8402/debug/route?source=env-slot `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"model":"minirouter/auto","messages":[{"role":"user","content":"summarize this short note"}]}'
```

## List Client Models

```powershell
Invoke-RestMethod http://localhost:8402/v1/models
```

With env slots configured, the list includes:

- `minirouter/auto`
- `minirouter/eco`
- `minirouter/premium`
- `minirouter/slot/balanced`
- `minirouter/slot/strong`
- `minirouter/slot/vision`

## Smoke Chat

```powershell
Invoke-RestMethod http://localhost:8402/v1/chat/completions `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"model":"minirouter/auto","messages":[{"role":"user","content":"Say ok in one word."}],"max_tokens":8}'
```

Use `minirouter/slot/strong` or `minirouter/slot/vision` when you want to force a
specific configured slot.
