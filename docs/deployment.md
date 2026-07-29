# Local deployment and smoke check

This repository is reproducible locally. Public hosting is not part of the current scope.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open `http://localhost:3000` and run the built-in demo. In another terminal:

```bash
pnpm smoke
```

`pnpm smoke` expects the app at `http://127.0.0.1:3000`; set `SMOKE_BASE_URL` to use another local or owner-provided environment. It checks `/api/health`, then sends local ALLOW, REVIEW, and BLOCK intents. The test writes audit records but does not move funds or broadcast a transaction.

Before any public deployment, the project owner must choose and configure a hosting provider. Do not add wallet credentials, private keys, Circle credentials, or production payment configuration to this repository.
