# Contributing

## Local checks

Use Node.js 22 or later, then run:

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
```

Keep pull requests focused, add or update tests for behavior changes, and do
not commit `.env` files, SQLite databases, or provider/API keys.
