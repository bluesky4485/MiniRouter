# MiniRouter

面向国内大模型的智能路由网关。自动识别任务难度，简单任务用高性价比模型，复杂任务用强模型。

## Docs

- [Routing MVP](docs/routing-mvp.md)
- [Headroom integration notes](docs/headroom.md)
- [Routing strategy](docs/routing-strategy.md)
- [Infra management design](docs/infra-management-design.md)

## Lightweight Cloud Management

MiniRouter can run as a normal Node service with SQLite on a lightweight cloud
host. For production-style use, set `MINIROUTER_SOLO=false`, create admin/user
API keys, and manage users, spend, and provider channels through the admin API.

- Admin console: `/admin/dashboard`
- Overview API: `/admin/overview`
- User API: `/admin/users`
- Provider channel API: `/admin/channels`

Env-configured model slots remain as a fallback. When DB-managed provider
channels exist for a slot, MiniRouter prefers healthy managed channels and uses
their weights for load distribution.
