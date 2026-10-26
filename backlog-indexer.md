# ForgeCapita Indexer — Development Backlog

This backlog tracks the multi-chain event indexer (`forgecapita-indexer`), built with Ponder, Viem, and Hono. It monitors `ForgeCapitaFactory` and `P2PExchange` on **Arbitrum Sepolia** (Chain ID `421614`) and **BSC Testnet** (Chain ID `97`), dynamically attaches listeners to cloned child contracts, and populates the shared Neon PostgreSQL database.

> **Legend:**
> - `[x]` Completed
> - `[ ]` Pending
> - `[USER-ACTION]` Requires manual action or credential provisioning from the repository owner/user.

---

## Phase 1: Core Indexing Engine & Dynamic Clones

### Multi-Chain Engine Setup
- [x] Configure Ponder multi-chain support for **Arbitrum Sepolia** (421614) and **BSC Testnet** (97) in `ponder.config.ts`.
- [x] Configure explicit contract `startBlock`s (Arbitrum: `322758932`, BSC: `138881864`) to prevent queries from genesis block 0.
- [x] Configure RPC block range throttles (`ethGetLogsBlockRange: 5000` for Arbitrum, `2000` for BSC) and request limits (`maxRequestsPerSecond: 3`).
- [ ] `[USER-ACTION]` Register for a dedicated private BSC Testnet RPC endpoint (e.g. NodeReal MegaNode free tier or BNB QuickNode) and set `PONDER_RPC_URL_97` in `.env.local` to resolve public RPC timeouts and rate limits.
- [ ] `[USER-ACTION]` Verify whether `BSC_FACTORY_ADDRESS` and `BSC_P2P_ADDRESS` differ from Arbitrum Sepolia in `.env.local`.
- [ ] `[USER-ACTION]` Verify Neon PostgreSQL database connectivity (`DATABASE_URL`) and ensure schema privileges exist.

### Core Schema & Relational Tables (`ponder.schema.ts`)
- [x] Define `project` table schema (`id`, `tokenAddress`, `distributorAddress`, `developer`, `fundingGoal`, `totalRaised`, `isFundingActive`, `isDeadlocked`, `createdAt`).
- [x] Define `milestone` table schema (`id`, `projectId`, `milestoneIndex`, `isVotingOpen`, `isExecuted`, `yesVotes`, `noVotes`).
- [x] Define `investor` table schema (`id`, `totalTokensStaked`, `totalYieldClaimed`).
- [x] Define `p2pListing` table schema (`id`, `seller`, `tokenAddress`, `tokenAmount`, `priceInETH`, `isActive`, `buyer`).
- [ ] Add `revenue_record` / `payment` table schema to index customer payments passing through `RevenueRouter`:
  - `id` (text primary key: txHash + logIndex)
  - `routerAddress` (hex)
  - `projectId` (hex)
  - `payer` (hex)
  - `grossAmount` (bigint)
  - `treasuryAmount` (bigint)
  - `creatorAmount` (bigint)
  - `investorAmount` (bigint)
  - `timestamp` (bigint)
- [ ] Add `isInvalidated` boolean column to `project` schema to track emergency token invalidations.

### Dynamic Factory Clone Listeners (`ponder.config.ts`)
- [x] Configure factory listener for `MilestoneEscrow` from `ForgeCapitaFactory:ProjectLaunched`.
- [x] Configure factory listener for `ProjectToken` from `ForgeCapitaFactory:ProjectLaunched`.
- [x] Configure factory listener for `DividendDistributor` from `ForgeCapitaFactory:ProjectLaunched`.
- [x] Configure factory listener for `RevenueRouter` from `ForgeCapitaFactory:ProjectLaunched`.

---

## Phase 2: Event Handlers & Lifecycle Management (`src/index.ts`)

### Factory & Crowdfunding Handlers
- [x] Handle `ForgeCapitaFactory:ProjectLaunched`: Insert initial `project` record.
- [ ] Read `MilestoneEscrow.fundingGoal()` dynamically during `ProjectLaunched` event handler using `context.client.readContract` instead of defaulting `fundingGoal: 0n`.
- [x] Handle `MilestoneEscrow:DepositReceived`: Increment `project.totalRaised`.
- [ ] Handle `MilestoneEscrow:PlatformFeeCollected`: Record the 5% platform fee transfer to Treasury when funding closes.

### Milestone Governance Handlers
- [x] Handle `MilestoneEscrow:VotingStarted`: Insert new `milestone` record with `isVotingOpen: true`.
- [x] Handle `MilestoneEscrow:Voted`: Update `yesVotes` and `noVotes` tally based on voter weight.
- [x] Handle `MilestoneEscrow:MilestoneExecuted`: Mark `milestone.isVotingOpen = false` and `isExecuted = true`.

### Revenue Routing & Secret Shopper Handlers (`RevenueRouter`)
- [ ] Implement handler for `RevenueRouter:PaymentReceived`:
  - Insert record into the new `revenue_record` table.
  - Required by the API's **Secret Shopper** audit service to reconcile against off-chain Shadow Wallet inflows.
- [ ] Implement handlers for `RevenueRouter:CreatorFundsClaimed` and `RevenueRouter:TreasuryFundsClaimed`.

### Staking & Yield Handlers (`DividendDistributor`)
- [x] Handle `DividendDistributor:Staked`: Track staked token balance per investor.
- [x] Handle `DividendDistributor:Withdrawn`: Decrement staked token balance.
- [x] Handle `DividendDistributor:YieldClaimed`: Increment cumulative claimed ETH dividends.

### P2P Secondary Market Handlers (`P2PExchange`)
- [x] Handle `P2PExchange:ListingCreated`: Insert active order with seller, token, amount, and price.
- [x] Handle `P2PExchange:ListingFilled`: Mark listing inactive and record buyer address.
- [x] Handle `P2PExchange:ListingCancelled`: Mark listing inactive.

### Project Lifecycle & Emergency State Handlers
- [ ] Handle `MilestoneEscrow:DeveloperTransferAccepted`: Update `project.developer` to reflect new developer address (Hostile Takeover tracking).
- [ ] Handle `MilestoneEscrow:ProjectCancelled`: Set `project.isFundingActive = false` and `project.isDeadlocked = true`.
- [ ] Handle `MilestoneEscrow:EmergencyShutdownTriggered`: Set `project.isFundingActive = false`, `project.isDeadlocked = true`, and mark token invalidated.
- [ ] Handle `MilestoneEscrow:RefundClaimed`: Track refund volume and remaining public tokens.

---

## Phase 3: Querying API & DevOps

### Hono API & Custom Endpoints (`src/api/index.ts`)
- [x] Mount GraphQL endpoint at `/graphql` and `/`.
- [x] Mount direct relational SQL client at `/sql/*`.
- [ ] Add custom query endpoints to aggregate revenue records by project ID for fast frontend consumption.

### DevOps & Resilience
- [x] Create base `Dockerfile` for containerized indexer execution.
- [ ] Add exponential backoff and error handling for intermittent RPC transport failures.
- [ ] Configure Docker Compose health checks verifying indexer sync status.
