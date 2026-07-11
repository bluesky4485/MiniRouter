# Routing strategy

This document describes the behavior implemented by the current env-slot
router.

## Selection flow

```text
request → detect protocol/features → profile → difficulty tier → provider slot
```

1. Requests with image, video, or audio content require the `vision` slot.
2. `minirouter/eco` selects `balanced`; `minirouter/premium` selects `strong`.
3. Other routed requests are classified by a weighted rule score into
   `SIMPLE`, `MEDIUM`, `COMPLEX`, or `REASONING`.
4. `SIMPLE` and `MEDIUM` select `balanced`; `COMPLEX` and `REASONING` select
   `strong`.
5. An explicitly selected slot must meet the request's tool capability.

`fast` is currently an explicit-slot option. It is not automatically selected
by the default tier mapping.

## Profiles

| Model | Behavior |
| --- | --- |
| `minirouter/auto` | Difficulty-based selection |
| `minirouter/eco` | Prefer `balanced` |
| `minirouter/premium` | Prefer `strong` |
| `minirouter/slot/<slot>` | Force one configured slot |

## Difficulty classifier

The rule classifier combines 14 weighted signals, including token count, code
presence, reasoning and technical terms, multi-step patterns, output format,
constraints, and domain specificity. The score is mapped to a tier using the
boundaries in [`src/router/config.ts`](../src/router/config.ts). Low-confidence
results fall back to the configured ambiguous tier, `MEDIUM` by default.

Client-declared effort is forwarded to the upstream provider but is not used to
select a model. Tool use is a capability requirement, not an automatic upgrade
to `strong`.

## Provider selection

Environment slots are the compatibility default. When database-managed provider
channels exist for a slot, MiniRouter selects a healthy compatible channel using
its weight and cooldown state. Provider API keys are never returned from the
admin API.
