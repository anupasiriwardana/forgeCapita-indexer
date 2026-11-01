# ForgeCapita Indexer — Service Status & Technical Health Report

**Service:** `forgecapita-indexer` (Multi-Chain Blockchain Event Indexer)  
**Framework:** Ponder 0.8+ / Viem / Hono  
**Database:** Neon PostgreSQL (Shared with `forgecapita-api`)  
**Networks:** Arbitrum Sepolia (Chain ID `421614`) & BSC Testnet (Chain ID `97`)  
**Port:** 42069  
**Last Updated:** 2026-11-01  

**Current focus:** Step: WS-02.3 | State: awaiting-review | Updated: 2026-11-01. (WS-05.2b commit status not recorded; review both diffs together if needed.)

**WS-02.3 result (tracker-verified 2026-11-01 by code reading; `npm run typecheck`, `npm run lint` exit 0; `DATABASE_SCHEMA=ponder npx ponder codegen` ok; no `any`/`@ts-ignore`/raw SQL; no `DEADLOCKED` in code; no `ponder dev/start`, DB or RPC run):** IDX-03, IDX-04, IDX-05 ticked. New `vote` table; `project` now carries v2 lifecycle fields; `ProjectLaunched` reads `fundingGoal`, `fundingDeadline`, `CLOSE_GRACE`, `REFUND_WINDOW`, `VOTING_PERIOD` and token name/symbol via `context.client.readContract` at the event block; 6 new handlers (31 `ponder.on` in total): `PlatformFeeCollected`, `ProjectCompleted`, `MilestoneFailed`, `ProjectCancelled`, `EmergencyShutdownTriggered`, `ProjectToken:TokenInvalidated`; `Voted` always writes a vote row (with `txFrom`) and no longer returns early; `MilestoneExecuted` stores `gasDebtRecouped` and does not write `gas_debt`; freeze events refresh the open milestone's `votingEndTime` via the pure `projectedVotingEnd`. All state changes go through `nextLifecycleState` in `src/projectState.ts` (pure, no ponder/viem imports). `milestoneCount` dropped (no contract getter); `project.router` address not stored yet (IDX-09). NOT RUN: the `readContract` paths and every new handler are unrun until the first sync (IDX-41); `projectState.ts` has no unit tests until IDX-40. Existing rows need a full reindex (new NOT NULL columns; the `ponder` schema is empty anyway). Findings (not fixed, for IDX-07/IDX-41/IDX-40): (1) `refundFailedCrowdfund` emits no event, so refunds of a failed crowdfund are invisible (`deposit.refunded` stays 0, `totalRaised` is never reduced); (2) `goalReached` for `fundingPhase` is caller-supplied: the contract compares its BALANCE with `fundingGoal`, the indexer only has `totalRaised` (sum of `DepositReceived`), so forced ETH could make the contract close-able while the indexer says not reached; (3) `fundingPhase` returns OPEN before the deadline even when the goal is met (the contract allows `closeFundingAndStart` then too); (4) `refundsOpenFor` is true for CANCELLED/FAILED until SHUTDOWN, but the contract also needs `remainingPublicTokens > 0` and the helper cannot see it; (5) after `emergencyShutdown` of a COMPLETED project the row keeps state COMPLETED with `isInvalidated` and `shutdownAt` set, `cancelledAt` stays null (the contract sets it): intended, completed wins; (6) historical `readContract` at old blocks may fail on the non-archive public BSC RPC during backfill (risk for IDX-41).

**WS-05.2b result (tracker-verified 2026-11-01; no `ponder dev/start`, DB or RPC run):** 7 new tables (`sponsored_gas`, `gas_debt`, `milestone_freeze`, `role_change`, `relayer_allowlist`, `registry_setting`, `token_map`, each with `chainId` + index), 13 new handlers (5 escrow v2 events, 7 Registry events, `ProjectToken:Transfer`), 25 `ponder.on` in total, existing 12 handlers unchanged except `ProjectLaunched` also writes `token_map`. `npm run typecheck`, `npm run lint` exit 0; `DATABASE_SCHEMA=ponder npx ponder codegen` ok; no `any`/`@ts-ignore`/raw SQL. `tokensHeld`/`tokensClaimed` are now populated from `Transfer` (the earlier caveat is resolved). The factory emit order was checked in `ForgeCapitaFactory.sol` (mint at `initialize` and factory->escrow transfer happen before `emit ProjectLaunched`, so `token_map` is empty for them and they are skipped); investor claims are a plain `projectToken.transfer(account, share)` from the escrow (`_claimTokens`), vesting is escrow->developer, refunds move tokens INTO the escrow (`transferFrom`), shutdown burns escrow tokens (to zero). P2P listings (seller->exchange, exchange->buyer or back to seller) are handled by excluding the exchange, and staked tokens leave `tokensHeld` when sent to the distributor (no double count with `stakedBalance`; total = `tokensHeld` + `stakedBalance`). NOT run: the new tables need a fresh sync (no data yet, the indexer was never started); Transfer accounting is untested against chain data until the first sync (IDX-41). Known limitations (findings, not fixed): developer who is also a depositor is not counted as claiming; tokens sent to other contracts count as held by them; the sender debit is clamped and never creates a row; additive updates rely on Ponder's indexed-once guarantee; `milestone_freeze.triggeredBy` is the tx sender.

**Update 2026-11-01 (user-reported, not verified by Claude, no env access):** WS-05.2 was reviewed and committed by the user. The indexer `.env.local` is completed (WS-05.1 indexer part / IDX-21 env part: v2 addresses incl. registry, `DATABASE_SCHEMA=ponder`, RPC URLs). It is now safe to run the indexer for the first time, only via `npm run dev` (schema guard). Advice: do WS-05.2b (v2 event tables) and WS-02.3 handlers BEFORE the first real sync, otherwise it indexes with missing handlers and needs a re-sync. The user decides.

**WS-05.2 result (tracker-verified 2026-11-01; no `ponder dev/start`, DB or RPC run):** all 7 v2 ABIs (Factory, Escrow, Token, Distributor, Router, P2P, Registry) synced and identical to the compiled contract artifacts; typed `as const` via generated `abis/<Name>Abi.ts` (`npm run abis`); `npm run typecheck` and `npm run lint` exit 0; the 12 existing handlers (`src/index.ts` unchanged) compile against v2 ABIs; v1 `I*.json` ABIs deleted. `ponder.config.ts`: v2 start blocks 324727776 (Arbitrum Sepolia) / 140034644 (BSC Testnet), env-overridable; Registry is a plain contract on both chains; schema guard throws unless the schema (`--schema` or `DATABASE_SCHEMA`) is `ponder`. Still open: new v2 events are unhandled (WS-05.2b, WS-02.3); `ProjectLaunched` still sets `fundingGoal` 0n (IDX-04); `tokensHeld`/`tokensClaimed` stay 0n. Guard notes: it also protects `ponder start`/`db` (config is loaded for every command); `ponder codegen` needs `DATABASE_SCHEMA=ponder` (documented in README, minor). Not verified at runtime: argv is preserved in the config-loading process. USER follow-up: the Neon `ponder` schema was dropped/empty (user-reported), so a fresh sync is expected and nothing needs migrating; before the first `ponder dev`, edit the real indexer env file (WS-05.1): v2 addresses incl. `ARB_REGISTRY_ADDRESS`/`BSC_REGISTRY_ADDRESS`, `DATABASE_SCHEMA=ponder`, RPC URLs.

**RE-PLAN 2026-11-01 (user decision, tracker docs-only; proposal awaiting approval, nothing started):** the indexer is rebuilt v2-first; v1 code, ABIs, addresses and data are discarded. Next steps in order: WS-05.2 (v2 ABIs `as const` incl. Registry, v2 start blocks 324727776 / 140034644 in `ponder.config.ts`, existing handlers compile, IDX-51/52), WS-05.1 [USER-ACTION] (user edits the indexer env), WS-05.2b (gas ledger, freeze, registry tables), WS-02.3 (votes, v2 project/milestone state, real `fundingGoal`), then WS-02.4 to WS-02.8. Obsolete items in this report: section 3.E (identical factory addresses are expected, v2 uses deterministic identical addresses), the 120-day inactivity state (removed in v2), section 3.D/3.C describe v1 and are superseded by IDX-04/IDX-07/IDX-10.

**Notes from WS-02.2 (tracker-verified by reading code, tsc and eslint; no DB, RPC or `ponder dev/start` run):** Schema now has `chainId` and composite text ids (`src/ids.ts`) on project, milestone, p2p_listing, position, deposit and the new distributor_map; `investor` removed; handlers use `context.chain.id`; `RefundClaimed` handler added. `package.json` `dev`/`start` pass `--schema ponder` (installed Ponder 0.18.x; CLI flag beats `DATABASE_SCHEMA`). New `.env.example` (placeholders). Open caveats: (1) `npm run typecheck` shows 71 errors (6 in `ponder.config.ts` TS2322, 65 in `src/index.ts` TS2339/TS2345 because event names resolve to `never`); root cause is the unchanged `ponder.config.ts` (ABI JSON not `as const`), so the handlers are NOT type-checked; backlog IDX-50. (2) `npm run lint` script broken (IDX-51); `npx eslint . --ext .ts` passes. (3) Running `npx ponder dev` directly (without `--schema`) would use `public`; IDX-52. (4) `tokensHeld`/`tokensClaimed` stay 0 until v2 ABIs. (5) Replay verified only at the WS-05 re-sync (IDX-41). User follow-up: copy `.env.example` values into the real env file yourself (Claude does not touch it); stale indexer tables in `public` were already dropped by you (user-reported).

**Decision 2026-11-01 (user):** IDX-50 is not fixed now; folded into WS-05.2 / IDX-10 (type the v2 ABIs `as const` when copying). Handlers therefore remain un-type-checked until then. Heads-up: WS-02.3+ handler work (IDX-03 votes, IDX-04 fundingGoal, IDX-05, etc.) is written against v1 events and will be partly rewritten for v2 at WS-05.2; the user may want to review which WS-02 items are v1-only and consider pulling the ABI sync forward (step order unchanged).

**Notes from WS-02.1 (user-reported, not verified by Claude):** BSC RPC is the free PUBLIC endpoint (publicnode), accepted by the user; watch for throttling during backfill, revisit with NodeReal/QuickNode if needed. Ponder schema on Neon is `ponder` (not `ponder_v2`); the API uses the same connection string with its tables in the default schema. The indexer config must use schema `ponder` and WS-02.2+ must check it never writes into the API's schema. The indexer has not been started (still v1 code/ABIs/addresses).

---

## 1. Executive Summary

The `forgecapita-indexer` monitors factory launches and secondary market trades across Arbitrum Sepolia and BSC Testnet. It dynamically attaches event listeners to cloned child contracts (`MilestoneEscrow`, `DividendDistributor`, `ProjectToken`, `RevenueRouter`) and writes structured data directly to the shared Neon PostgreSQL database.

The core indexing pipeline, multi-chain configuration, start-block pinning, staking accounting, and P2P orderbook tracking are **operational**. `fundingGoal` is now read from the escrow at launch (no longer `0n`), and votes plus the v2 lifecycle (completed, failed, cancelled, shutdown) are handled (WS-02.3, unrun until the first sync). **The absence of `RevenueRouter` indexing (which breaks the API's Secret Shopper audit), still-unhandled developer-change events, and BSC public RPC rate-limiting require engineering and user attention.**

---

## 2. Operational Features (Working)

- **Multi-Chain Setup & Start Blocks (`ponder.config.ts`):**
  - Configured for Arbitrum Sepolia (`421614`) and BSC Testnet (`97`).
  - Pinned `startBlock: 322758932` (Arbitrum) and `138881864` (BSC), preventing wasteful queries from block 0.
  - Chunk limits enabled (`ethGetLogsBlockRange: 5000` for Arbitrum, `2000` for BSC).
- **Dynamic Factory Clone Listeners:**
  - Automatically captures `ForgeCapitaFactory:ProjectLaunched` and attaches event handlers to child proxy addresses: `milestoneEscrow`, `projectToken`, `dividendDistributor`, and `revenueRouter`.
- **Active On-Chain Event Handlers (`src/index.ts`):**
  - **Crowdfunding Deposits:** `MilestoneEscrow:DepositReceived` accurately updates `project.totalRaised`.
  - **Milestone Governance:** `MilestoneEscrow:VotingStarted`, `Voted`, and `MilestoneExecuted` create and update `milestone` records.
  - **Staking & Yield Tracking:** `DividendDistributor:Staked`, `Withdrawn`, and `YieldClaimed` maintain accurate per-investor positions.
  - **P2P Secondary Market:** `P2PExchange:ListingCreated`, `ListingFilled`, and `ListingCancelled` maintain real-time orderbook status.
- **Query APIs (`src/api/index.ts`):**
  - Exposes Hono GraphQL server (`/graphql` and `/`) and raw SQL endpoint (`/sql/*`).

---

## 3. Critical Issues & Immediate Blockers

### A. Missing `RevenueRouter` Event Indexing & Schema
- **Status:** **CRITICAL ARCHITECTURAL BLOCKER** 🚨
- **Problem:**
  - `about.md` Section 3.C specifies that the backend API's **Secret Shopper** service compares off-chain Shadow Wallet inflows against on-chain `PaymentReceived` events indexed from `RevenueRouter`.
  - Although `RevenueRouter` is declared as a factory contract in `ponder.config.ts`, **no handlers exist in `src/index.ts`** for `RevenueRouter` events.
  - Furthermore, `ponder.schema.ts` lacks any table (e.g. `revenue_record` or `payment`) to persist customer payment splits (gross amount, 1% treasury, 24% creator, 75% dividend pool).
- **Impact:** The compliance auditing and revenue-sharing verification pipeline cannot function because payment transactions are never indexed.
- **Remedy Required:** Add a `revenue_record` table to `ponder.schema.ts` and handle `RevenueRouter:PaymentReceived` in `src/index.ts`.

### B. BSC Testnet Public RPC Instability & Throttling
- **Status:** **RPC RATE LIMIT BLOCKER** ⚠️
- **Problem:**
  - The public RPC endpoint `https://bsc-testnet-rpc.publicnode.com` frequently times out or responds with `LimitExceededRpcError` during backfills.
- **Impact:** The indexer container can fail to sync or fall out of lockstep with incoming blocks on BSC Testnet.
- **Update 2026-11-01 (user-reported):** IDX-20 closed with the free public publicnode endpoint kept as `PONDER_RPC_URL_97` (accepted risk; v2 backfill from block 140034644 is small). Revisit with NodeReal/QuickNode if throttled.

### C. `fundingGoal` Defaulting to `0n` - RESOLVED (WS-02.3, 2026-11-01)
- `ProjectLaunched` now reads `fundingGoal()` (and the other constants) with `context.client.readContract` at the launch block. Unrun until the first sync (IDX-41).

### D. Unhandled Governance & Lifecycle Events
- **Status:** **DESYNC RISK** ⚠️
- **Problem:**
  - `MilestoneEscrow:DeveloperTransferAccepted`: When Treasury or developers execute a Hostile Takeover / developer change, `project.developer` is not updated in the database.
  - `MilestoneEscrow:ProjectCancelled` and `EmergencyShutdownTriggered`: RESOLVED in WS-02.3 (state CANCELLED / SHUTDOWN, `cancelledAt`, `shutdownAt`, `isInvalidated`).
  - `MilestoneEscrow:RefundClaimed`: Refund withdrawals are unrecorded.
- **Impact:** Frontend and API will show outdated developer ownership and indicate cancelled or shut-down projects as still active.

### E. Identical Factory Addresses in `.env.local`
- **Status:** **CONFIGURATION CHECK REQUIRED** ⚠️
- **Problem:**
  - In `forgecapita-indexer/.env.local`:
    `ARB_FACTORY_ADDRESS="0x9b55Cb74b55bc835fC0E57Ab735637C64Ff21990"`
    `BSC_FACTORY_ADDRESS="0x9b55Cb74b55bc835fC0E57Ab735637C64Ff21990"`
  - Both environment variables point to the exact same contract address.
- **Impact:** Unless deployed via deterministic `CREATE2` to the exact same address on both chains, BSC Testnet indexing may target an invalid contract.
- **Remedy Required `[USER-ACTION]`:** User must verify if the BSC factory was deployed to this address or update it with the correct BSC contract address.

---

## 4. Additional data-model findings (2026-10-28)

- ~~No `chainId` on any table~~ and ~~`investor` keyed by wallet only~~: FIXED in WS-02.2 (2026-11-01), see Current focus notes.
- **No trade, launch-provenance or developer-change history**; raw `/sql/*` is exposed publicly.
- **Production schema:** `ponder dev` uses `public` (the user confirmed `project` and `startup_profiles` both sit there); `ponder start` needs an explicit schema, and a views schema is recommended for the API.

## 5. Plan revision (2026-10-28)

The backlog was rewritten (`backlog-indexer.md`). Contracts v2 will be redeployed (gasless relayer, gas ledger, freeze, roles) and the indexer re-synced once, so the data-model fixes (IDX-01 to IDX-09) go first, v2 event handling (IDX-10) follows the new ABIs, and new addresses / start blocks (IDX-21) are provided after deployment.

## 6. Summary Checklist of Next Steps

1. [ ] IDX-01 to IDX-09 data-model correctness: [x] IDX-01 chainId and composite ids, [x] IDX-02 per-project positions/deposits (2026-11-01); [x] IDX-03 votes, [x] IDX-04 richer project and real `fundingGoal`, [x] IDX-05 milestone additions (WS-02.3, 2026-11-01, awaiting review, unrun until the first sync); [ ] remaining lifecycle handlers, launch provenance, `RevenueRouter` (IDX-06 to IDX-09).
1a. [x] IDX-50 ABI `as const` typing, IDX-51 `npm run lint`, IDX-52 schema guard, IDX-23 ABI sync, IDX-10 part 1, IDX-21 code part (WS-05.2, 2026-11-01, awaiting review). [x] IDX-21 env part (user, WS-05.1; user-reported 2026-11-01, not verified), [x] IDX-10 part 2 (WS-05.2b, 2026-11-01, awaiting review).
2. [x] `[USER-ACTION]` IDX-20 BSC Testnet RPC (public endpoint, accepted); IDX-22 production schema check (schema `ponder`) - user-reported 2026-11-01.
3. [ ] IDX-30 to IDX-33 lock down `/sql`, GraphQL limits, stats endpoints, health.
4. [ ] (IDX-10 part 2 and WS-02.3 done) next WS-02.4 (IDX-07, IDX-08), then first full sync (fresh `ponder` schema; IDX-21 env part done, user-reported).

## Change log

2026-11-01  WS-02.3  IDX-03, IDX-04, IDX-05 ticked: `vote` table and handler, v2 project lifecycle columns, real `fundingGoal` via `readContract`, 6 new handlers, pure `src/projectState.ts`; `milestoneCount` dropped; DEADLOCKED removed from docs.  - verified by: read `ponder.schema.ts`, `src/projectState.ts`, `src/index.ts`, `src/ids.ts`, `MilestoneEscrow.sol` (closeFundingAndStart, refundFailedCrowdfund, refundDeadProject, emergencyShutdown, votingEnd); `npm run typecheck` and `npm run lint` exit 0; `DATABASE_SCHEMA=ponder npx ponder codegen` ok; grep no `any`/`@ts-ignore`/raw SQL, `projectState.ts` has no imports; not verified: any run (readContract paths, new handlers unrun until IDX-41; no unit tests until IDX-40)

2026-11-01  WS-05.2b  IDX-10 ticked (part 2): 7 v2 tables, 13 handlers incl. `ProjectToken:Transfer` (tokensHeld/tokensClaimed caveat resolved), `token_map` written in `ProjectLaunched`.  - verified by: read `ponder.schema.ts`, `src/ids.ts`, `src/index.ts`; `npm run typecheck` and `npm run lint` exit 0; `DATABASE_SCHEMA=ponder npx ponder codegen` ok; grep no `any`/`@ts-ignore`/raw SQL; 25 `ponder.on`; `git diff --stat` only schema, ids, index, docs; read `ForgeCapitaFactory.sol`, `MilestoneEscrow.sol`, `ProjectToken.sol`, `P2PExchange.sol` for transfer flows; not verified: any run against chain data/DB (fresh sync needed, IDX-41)

2026-11-01  WS-05.2 / WS-05.1  WS-05.2 recorded as reviewed and committed; IDX-21 env part ticked; first run allowed via `npm run dev` only; advised WS-05.2b + WS-02.3 before first sync.  - verified by: user report only, not verified (Claude has no env-file access)

2026-11-01  WS-05.2  IDX-23, IDX-50, IDX-51, IDX-52 ticked; IDX-10 part 1 and IDX-21 code part done (parts 2 / env stay open). 7 v2 ABIs synced and typed `as const`, v2 start blocks, Registry registered, schema guard, lint script.  - verified by: `npm run typecheck` exit 0, `npm run lint` exit 0; script comparing each ABI JSON with `forgecapita-contracts/artifacts` (identical for all 7) and generated `.ts` with JSON; read `ponder.config.ts`, `scripts/generate-abis.mjs`, `package.json`, `.env.example`, README; grep: no `@ts-ignore`/`any` in `src/`, no `I*.json` leftovers, 12 `ponder.on` names present; no other repo shows changes; not verified: `ponder codegen`/`dev`/`start`, DB, RPC (dev reports codegen ran offline)
2026-11-01  re-plan  Indexer made v2-first: WS-05.2 pulled first (IDX-10 part 1, IDX-21 code part, IDX-23, IDX-50 absorbed, IDX-51/52 folded in), WS-05.1 split into an indexer-only env [USER-ACTION], new WS-05.2b (IDX-10 part 2), WS-02.3 to WS-02.8 re-tagged v2/version-independent; found start blocks and ProjectLaunched are hardcoded in `ponder.config.ts` (v1 values).  - verified by: docs-only edit; read `ponder.config.ts`, `ForgeCapitaFactory.sol`, event declarations in `contracts/`; no source touched

2026-11-01  docs  IDX-50 deferred into IDX-10 / WS-05.2 per user decision; added v1-only warning for WS-02.3+ handlers.  - verified by: docs-only edit, no source touched

2026-11-01  WS-02.2  IDX-01, IDX-02 ticked with caveats; added IDX-50 (ABI typing), IDX-51 (lint script), IDX-52 (schema guard).  - verified by: reading ponder.schema.ts, src/ids.ts, src/index.ts, package.json, .env.example; `npx eslint . --ext .ts` clean; `npx tsc --noEmit` 71 errors (6 config + 65 handlers), config file unchanged vs HEAD per git status so errors predate the step (a HEAD-copy comparison was inconclusive because Ponder's virtual types resolve the real repo config); `npm run lint` fails as claimed; no leftover `investor` table usage; not verified: DB run, `ponder dev/start`, `ponder codegen`

2026-11-01  WS-02.1  IDX-20 and IDX-22 ticked; BLOCKED section removed. IDX-20 uses the free public publicnode BSC RPC (accepted by user, risk noted); IDX-22 Neon schema is `ponder`, indexer config must use it (check in WS-02.2+).  - verified by: user report only, not verified (Claude has no env-file access)
