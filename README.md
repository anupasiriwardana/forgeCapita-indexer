# forgeCapita-indexer

`forgeCapita-indexer` is the on-chain data layer for the forgeCapita-v2 ecosystem, built using the Ponder TypeScript indexing framework. 

It continuously listens to the Arbitrum Sepolia and BSC Testnet for events emitted by the core forgeCapita smart contracts (`ForgeCapitaFactory`, `MilestoneEscrow`, `DividendDistributor`, `RevenueRouter`, and `P2PExchange`). It decodes these raw EVM events, transforms them using end-to-end type-safe indexing functions, and writes the structured data into a shared PostgreSQL (Neon) database. This provides an auto-generated GraphQL API that powers the Next.js frontend and Express.js off-chain backend.

## ABIs (v2)

`abis/<Name>.json` (synced Hardhat artifacts) is the source of truth; `abis/<Name>Abi.ts` is generated from it with `as const` typing and must not be hand-edited. To refresh after the contracts are recompiled:

```
# from the workspace root
node .claude/scripts/sync-abi.js indexer ForgeCapitaFactory MilestoneEscrow ProjectToken DividendDistributor RevenueRouter P2PExchange ForgeCapitaRegistry
# then, in forgecapita-indexer
npm run abis
```

## HTTP API hardening (src/api/index.ts)

- `/` and `/graphql` serve GraphQL (public; the frontend POSTs here). Explicit limits on both mounts: 1000 operation tokens, depth 10, 15 aliases. POST bodies over 16 KB get 413.
- Row cap: Ponder hardcodes a page size of 1000 (`limit > 1000` throws). It is not configurable, so no lower cap is enforced.
- `/sql/*` (Ponder's read-only SQL client) is NOT mounted by default and never in production. It is only mounted when `ENABLE_SQL_API=true` and `NODE_ENV` is not `production`. `forgecapita-api` reads Postgres directly and the frontend uses GraphQL only.
- CORS is NOT restrictable from this repo. Ponder installs `cors({ origin: "*" })` globally before user routes, and it answers preflight (OPTIONS) itself, so route code never sees it. No `CORS_ORIGINS` setting exists; restrict origins at a reverse proxy/CDN if needed. GraphQL is therefore callable from any origin; the limits above are the only protection.

## Built-in endpoints (do not redefine; custom routes with these names fail the build)

- `/health`: always 200 once the HTTP server is up, including during backfill. The Render keep-alive cron pings this. Docker `HEALTHCHECK` uses it.
- `/ready`: 200 after historical sync completes, otherwise 503. Use as the readiness signal for load balancers, not for Docker liveness.
- `/status`: JSON with the latest indexed block per chain. `/metrics`: Prometheus metrics.

## Stats REST endpoints (src/api/stats.ts)

Read-only GET routes mounted after the GraphQL middleware. Not to be confused with the built-in `/status` (latest indexed block per chain): these are `/stats/...` and business aggregates. Ponder's global CORS applies. All amounts are decimal strings (wei or native units of the chain); every row-level item carries `chainId`; addresses are lowercase. Invalid input returns `400 {"error": "..."}`; an unknown project returns `404` on the revenue and gas-ledger routes; failures return a generic `500` (detail is only logged).

- `:chainId` must be one of the configured chains (421614, 97); `:address` must be a 0x + 40 hex address.
- `limit` below 1, or non-numeric/negative `limit` or `offset`, is a 400; values above the cap are clamped (`offset` cap 10000).

1. `GET /stats/overview?chainId=` returns `{ generatedAt, chains: [...] }` with one entry per chain (zeros when empty), never summed across chains because the native currencies differ (ETH on Arbitrum Sepolia, BNB on BSC Testnet). Each chain has `projectsByState`, `activeVotes`, `totalRaised`, `platformFeesCollected` (from `FEE_COLLECTED` lifecycle rows), `revenue`, `sponsoredGas` (with `byAction` 0 to 3), `gasDebt` and `p2p`. Cached in-process for 15 seconds per `chainId` filter (concurrent misses share one query, errors are never cached) and sent with `Cache-Control: public, max-age=15`. This is the only route with that header.
2. `GET /projects/:chainId/:address/revenue` returns `totals` (zeros if no payment yet) and up to 120 `months` (newest first).
3. `GET /investors/:address/positions?chainId=&limit=&offset=` merges deposit and staking rows per project (missing values are `"0"`). `limit` default 50, max 100.
4. `GET /projects/:chainId/:address/gas-ledger?limit=&offset=&action=` returns `summary` (`gasSpent` is the newest row's cumulative value, not a sum), `sponsored` rows newest first (`limit` default 50, max 200, optional `action` 0 to 3) and the latest 100 `debt` rows.

## RPC endpoints and failover

Each chain takes `PONDER_RPC_URL_<chainId>` plus an optional `PONDER_RPC_URL_<chainId>_FALLBACK`, deduplicated into an array; with neither set the public default is used. Invalid URLs fail fast at startup with a message that does not print the value. Ponder load-balances across the array per host, retries failed requests up to 9 times with exponential backoff (125 ms base), and deactivates a rate-limited (429) or timed-out host temporarily with backoff reactivation. A startup diagnostic only warns if the endpoint reports a different chain id than configured.

## Production runbook

- Production runs `npm run start` (`ponder start --schema ponder --views-schema ponder_live`), never `dev`. `dev` has no views support and stays `ponder dev --schema ponder`.
- `ponder_live` holds stable views over the active schema; `forgecapita-api` may read it so a re-index does not break reads. The views schema name is limited to 45 characters. The database role must be able to CREATE that schema (unverified, check at first sync).
- Inspect or prune with `npm run db -- <command>` (for example `npm run db -- list`; see `ponder db --help`).
- Full re-index with minimal downtime: start the new build against a new schema name (`ponder start --schema ponder_v2 --views-schema ponder_live`), wait for `/ready` to return 200, then the views switch to the new schema. The schema guard currently requires exactly `ponder`, so a swap needs a conscious, reviewed relaxation of `REQUIRED_SCHEMA` (for example an allow-list `ponder` or `ponder_*`); it has intentionally not been loosened. Do not run the old and new builds against the same schema.

## Schema guard

`ponder.config.ts` throws at load time unless the effective schema is `ponder` (`--schema ponder` CLI flag, otherwise `DATABASE_SCHEMA=ponder`), so the indexer can never write to `public`. This also applies to `ponder codegen`; set `DATABASE_SCHEMA=ponder` when running it.
