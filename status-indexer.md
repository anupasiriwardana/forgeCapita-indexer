# ForgeCapita Indexer — Service Status & Technical Health Report

**Service:** `forgecapita-indexer` (Multi-Chain Blockchain Event Indexer)  
**Framework:** Ponder 0.8+ / Viem / Hono  
**Database:** Neon PostgreSQL (Shared with `forgecapita-api`)  
**Networks:** Arbitrum Sepolia (Chain ID `421614`) & BSC Testnet (Chain ID `97`)  
**Port:** 42069  
**Last Updated:** Current Sprint  

---

## 1. Executive Summary

The `forgecapita-indexer` monitors factory launches and secondary market trades across Arbitrum Sepolia and BSC Testnet. It dynamically attaches event listeners to cloned child contracts (`MilestoneEscrow`, `DividendDistributor`, `ProjectToken`, `RevenueRouter`) and writes structured data directly to the shared Neon PostgreSQL database.

The core indexing pipeline, multi-chain configuration, start-block pinning, staking accounting, and P2P orderbook tracking are **operational**. However, **the complete absence of `RevenueRouter` indexing (which breaks the API's Secret Shopper audit), hardcoded `fundingGoal: 0n`, unhandled lifecycle/takeover events, and BSC public RPC rate-limiting require immediate engineering and user attention**.

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
- **Remedy Required `[USER-ACTION]`:** The user must register for a dedicated RPC endpoint (NodeReal MegaNode free tier or BNB QuickNode) and set `PONDER_RPC_URL_97` in `.env.local`.

### C. `fundingGoal` Defaulting to `0n`
- **Status:** **DATA ACCURACY DEFICIT** ⚠️
- **Problem:**
  - In `ForgeCapitaFactory:ProjectLaunched` handler:
    ```typescript
    fundingGoal: 0n, // We can pull this dynamically if added to the event, or default it
    ```
- **Impact:** All projects indexed via `ProjectLaunched` display a funding goal of 0 in the database, breaking frontend progress calculations (`totalRaised / fundingGoal`) unless updated.
- **Remedy Required:** Query the smart contract via `context.client.readContract({ abi: EscrowJSON.abi, address: event.args.milestoneEscrow, functionName: 'fundingGoal' })` inside the event handler.

### D. Unhandled Governance & Lifecycle Events
- **Status:** **DESYNC RISK** ⚠️
- **Problem:**
  - `MilestoneEscrow:DeveloperTransferAccepted`: When Treasury or developers execute a Hostile Takeover / developer change, `project.developer` is not updated in the database.
  - `MilestoneEscrow:ProjectCancelled` and `EmergencyShutdownTriggered`: Do not update `isFundingActive = false` or `isDeadlocked = true`.
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

## 4. Summary Checklist of Next Steps

1. [ ] Add `revenue_record` table to `ponder.schema.ts`.
2. [ ] Implement `RevenueRouter:PaymentReceived` event handler in `src/index.ts`.
3. [ ] Fetch dynamic `fundingGoal` from the escrow contract in `ProjectLaunched` handler.
4. [ ] Implement handlers for `DeveloperTransferAccepted`, `ProjectCancelled`, and `EmergencyShutdownTriggered`.
5. [ ] `[USER-ACTION]` Provide dedicated BSC Testnet RPC URL (NodeReal/QuickNode) in `.env.local`.
6. [ ] `[USER-ACTION]` Confirm BSC contract addresses in `.env.local`.
