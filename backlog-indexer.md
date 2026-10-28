# ForgeCapita Indexer — Development Backlog

This backlog tracks the multi-chain event indexer (`forgecapita-indexer`), built with Ponder, Viem and Hono. It indexes `ForgeCapitaFactory` and `P2PExchange` on **Arbitrum Sepolia** (`421614`) and **BSC Testnet** (`97`), attaches listeners to cloned child contracts, and populates the shared Neon PostgreSQL database that the API reads.

> **Legend:**
> - `[x]` Completed
> - `[ ]` Pending
> - `[USER-ACTION]` Requires manual action or credential provisioning from the repository owner/user.
> - `[BLOCKED-BY]` Cannot start until another backlog item is done.
> - `[DEFERRED]` Planned, not scheduled.

Item IDs (`IDX-xx`) are referenced from `ROADMAP.md`. Plan revised 2026-10-28.

## Decisions that shape this backlog

- **Contracts v2 will be redeployed** (new factory / P2P addresses and start blocks) and the indexer re-synced from scratch. Data-model fixes (IDX-01 to IDX-10) should land **before** the v2 re-sync so the re-sync happens once. v1 data is not migrated.
- **Every table carries `chainId`** and composite keys. The same factory address can no longer be assumed on both chains.
- **Production uses a named schema plus a views schema.** `ponder dev` writes to `public`; `ponder start` requires `DATABASE_SCHEMA` / `--schema`. The API reads through a configurable schema name (`PONDER_SCHEMA`, API-06). The user confirmed that today `project` and `startup_profiles` both sit in `public`.
- The indexer is the **single source of truth for on-chain state** used by the API (relayer eligibility, reconciliation, signalling vote snapshots, gas ledger display).

---

## Phase 0: Existing engine

- [x] Multi-chain Ponder config for Arbitrum Sepolia (421614) and BSC Testnet (97), pinned start blocks (Arbitrum `322758932`, BSC `138881864`), `ethGetLogsBlockRange` 5000 / 2000, `maxRequestsPerSecond: 3`.
- [x] Factory-driven listeners for `MilestoneEscrow`, `ProjectToken`, `DividendDistributor`, `RevenueRouter` from `ProjectLaunched`.
- [x] Tables: `project`, `milestone`, `investor`, `p2pListing`.
- [x] Handlers: `ProjectLaunched`, `DepositReceived`, `VotingStarted`, `Voted`, `MilestoneExecuted`, `Staked`, `Withdrawn`, `YieldClaimed`, `ListingCreated`, `ListingFilled`, `ListingCancelled`.
- [x] Hono GraphQL at `/graphql` and `/`; raw SQL client at `/sql/*`.
- [x] Base `Dockerfile`.

## Phase 1: Data model correctness (do before the v2 re-sync)

- [ ] **IDX-01** Add `chainId` to every table and use composite ids (`${chainId}:${address}` and `${chainId}:${txHash}:${logIndex}` for events). Expose `chainId` in GraphQL so consumers can filter by chain.
- [ ] **IDX-02** Replace the wallet-keyed `investor` table with per-project records: `position` (chainId, project, investor, staked balance, yield claimed, tokens held / claimed) and `deposit` (invested amount, refunded amount, tokens claimed). Staking events only carry the user and amount, so resolve project via the distributor-address-to-project mapping.
- [ ] **IDX-03** `vote` table: chainId, project, milestone, voter, support, weight, tx hash, block time. Keep milestone tallies derived from handler logic and verifiable against votes.
- [ ] **IDX-04** Richer `project` state: `state` enum (`FUNDING / ACTIVE / COMPLETED / FAILED / CANCELLED / DEADLOCKED / SHUTDOWN`), `fundingDeadline`, `fundingClosedAt`, `platformFee`, `milestoneCount`, `currentMilestoneIndex`, `totalStaked`, `isInvalidated`, `tokenSymbol` / `tokenName` if available, `escrow / token / distributor / router` addresses. Replace `fundingGoal: 0n` by reading `fundingGoal()` (and other constants) from the escrow with `context.client.readContract` in the `ProjectLaunched` handler.
- [ ] **IDX-05** `milestone` additions: unlock percent, voting start / end, deadline, executed time, amount released, deduction (v2).
- [ ] **IDX-06** `trade` table for P2P fills (listing, buyer, seller, token, amount, price, fee, time) and `p2pListing` chainId + cancelled / filled timestamps.
- [ ] **IDX-07** Lifecycle handlers: `DeveloperTransferProposed` / `DeveloperTransferAccepted` → `developer_change` table + update `project.developer`; `ProjectCancelled`; `EmergencyShutdownTriggered` (also sets `isInvalidated`); `RefundClaimed` (refund volume and remaining public tokens); `FundingClosed`; `PlatformFeeCollected` (fee record).
- [ ] **IDX-08** Launch provenance on `project`: launcher address (transaction `from` and the factory call's `msg.sender`), launch tx hash and block. Needed by the API's rogue-deployment sync (API-40) to compare a launch with approved applications and linked wallets.
- [ ] **IDX-09** `RevenueRouter` indexing: `revenue_record` (chainId, router, project, payer, gross, treasury, creator, investor, USD-neutral raw amounts, tx, time) from `PaymentReceived`, plus `router_claim` from creator / treasury claim events. Add per-project and per-month aggregates for the reconciliation job (API-50).
- [ ] **IDX-10** v2 events (after `CON-02.*` finalises ABIs): `sponsored_gas` (project, action type, signer, cost, cumulative spent), `gas_debt_recovered`, `milestone_freeze` (frozen / unfrozen, by whom), `role_change` (treasury / guardian / relayer), plus `relayer_allowlist`. `[BLOCKED-BY]` contracts v2 ABIs.
- [ ] **IDX-11** Snapshot support for the off-chain takeover vote: helper endpoint or table returning staked balance per investor for a project at a given block (derived from staking events), used by API-62.

## Phase 2: Configuration & chains

- [ ] **IDX-20 `[USER-ACTION]`** Dedicated BSC Testnet RPC (NodeReal MegaNode free tier or QuickNode) as `PONDER_RPC_URL_97`; the public node times out and rate-limits during backfills.
- [ ] **IDX-21 `[USER-ACTION]`** Per-chain addresses and start blocks for v2 (`ARB_FACTORY_ADDRESS`, `BSC_FACTORY_ADDRESS`, `ARB_P2P_ADDRESS`, `BSC_P2P_ADDRESS`, start blocks) from `docs/deployments-v2.md` once CON-04.2 is done. The v1 `.env.local` pointed both chains at one factory address; confirm they differ or are deterministic.
- [ ] **IDX-22 `[USER-ACTION]`** Verify Neon connectivity and schema privileges for a dedicated production schema (not `public`).
- [ ] **IDX-23** Sync v2 ABIs with `node .claude/scripts/sync-abi.js indexer <Contract>` for every changed contract; remove the unused v1 ABI imports.
- [ ] **IDX-24** Multi-transport RPC with fallback (`fallback([...])`) and retry / backoff for transient failures; log RPC errors with the chain id.
- [ ] **IDX-25** Production run configuration: `ponder start --schema <name>` with a views schema for the API (`ponder_live`; confirm the exact flag for the installed Ponder version), documented runbook for full re-index, zero-downtime schema swap.

## Phase 3: Query layer

- [ ] **IDX-30** Lock down `/sql/*`: disable in production or require an internal API key / network restriction. The API must not depend on it for public traffic.
- [ ] **IDX-31** GraphQL protection: query depth and complexity limits, pagination caps, CORS allow-list, request-size limit.
- [ ] **IDX-32** Custom REST endpoints (Hono): `GET /stats` (total raised, projects by state, active votes, fees, sponsored gas), `GET /projects/:chainId/:address/revenue` (aggregates), `GET /investors/:address/positions`, `GET /projects/:chainId/:address/gas-ledger`.
- [ ] **IDX-33** Health: Ponder `/health` and `/ready` exposed; Docker Compose healthcheck verifying sync status; Render keep-alive documented (`system-architecture-and-tech-stack.md`).

## Phase 4: Quality

- [ ] **IDX-40** Unit tests (vitest) for pure helpers: composite id builders, state derivation, tally maths, snapshot calculation.
- [ ] **IDX-41** Replay test against a fork / small block range on each testnet: expected row counts for a known project, idempotent re-run.
- [ ] **IDX-42** Schema and handler review for reorg safety and idempotency (Ponder handles reorgs; verify no handler uses external mutable state).
- [ ] **IDX-43** `npm audit` and pinned dependency versions; refresh `README` setup steps.
- [ ] **IDX-44 `[USER-ACTION]`** GitHub Actions CI (typecheck, codegen, tests).
