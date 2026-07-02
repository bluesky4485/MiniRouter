# MiniRouter

智能 LLM 路由网关 — 面向国内大模型，自动识别任务难度选择最优性价比模型。

## 项目结构

```
src/
├── router/              # 14维规则路由引擎 (<1ms)
├── compression/         # 上下文压缩
├── db/                  # 数据层 (SQLite + Drizzle)
├── auth/                # API Key 认证
├── server/              # HTTP API (Hono)
├── models.ts            # 模型注册表
└── model-registry.ts    # 模型评分数据库
```

## 数据维护

- `models-dashboard.html` — 模型可视化表格
- `.claude/skills/update-model-registry/` — 模型数据更新 Skill