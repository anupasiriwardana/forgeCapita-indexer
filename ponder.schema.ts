import { index, onchainTable } from "ponder";

// All ids are chain-scoped composites built in src/ids.ts.

// 1. Projects (Startups launched via Factory)
export const project = onchainTable(
  "project",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}:${escrowAddress}`
    chainId: t.integer().notNull(),
    escrowAddress: t.hex().notNull(),
    tokenAddress: t.hex().notNull(),
    distributorAddress: t.hex().notNull(),
    developer: t.hex().notNull(),
    fundingGoal: t.bigint().notNull(),
    totalRaised: t.bigint().notNull(),
    isFundingActive: t.boolean().notNull(),
    // Event-driven lifecycle: FUNDING | ACTIVE | COMPLETED | FAILED | CANCELLED | SHUTDOWN.
    // Time-only transitions (close-grace expiry) emit no event; see src/projectState.ts.
    state: t.text().notNull(),
    fundingDeadline: t.bigint().notNull(),
    closeGrace: t.bigint().notNull(),
    refundWindow: t.bigint().notNull(),
    votingPeriod: t.bigint().notNull(), // read once at launch
    fundingClosedAt: t.bigint(),
    platformFee: t.bigint(),
    cancelledAt: t.bigint(), // MilestoneFailed and ProjectCancelled both set it on-chain
    failedMilestoneIndex: t.integer(),
    isInvalidated: t.boolean().notNull().default(false),
    shutdownAt: t.bigint(),
    currentMilestoneIndex: t.integer().notNull().default(0),
    totalStaked: t.bigint().notNull().default(0n),
    tokenName: t.text().notNull(),
    tokenSymbol: t.text().notNull(),
    createdAt: t.bigint().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    developerIdx: index().on(table.developer),
  }),
);

// Resolves a distributor (its events carry no project) to its project.
export const distributorMap = onchainTable(
  "distributor_map",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}:${distributorAddress}`
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    escrowAddress: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
  }),
);

// Resolves a RevenueRouter (its events carry no project) to its project.
export const routerMap = onchainTable(
  "router_map",
  (t) => ({
    id: t.text().primaryKey(), // routerKey(chainId, routerAddress)
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    escrowAddress: t.hex().notNull(),
    routerAddress: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
  }),
);

// 2. Project Milestones
export const milestone = onchainTable(
  "milestone",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}:${escrowAddress}:${milestoneIndex}`
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    milestoneIndex: t.integer().notNull(),
    isVotingOpen: t.boolean().notNull(),
    isExecuted: t.boolean().notNull(),
    yesVotes: t.bigint().notNull(),
    noVotes: t.bigint().notNull(),
    unlockPercentage: t.integer().notNull(),
    description: t.text().notNull(),
    votingStartTime: t.bigint().notNull(),
    frozenAtVoteStart: t.bigint().notNull(),
    // Tracks freeze events; the contract's votingEndTime(i) stays authoritative.
    votingEndTime: t.bigint().notNull(),
    executedAt: t.bigint(),
    amountReleased: t.bigint(),
    tokensVested: t.bigint(),
    gasDebtRecouped: t.bigint(),
    isFailed: t.boolean().notNull().default(false),
    failedAt: t.bigint(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
  }),
);

// 2b. Votes (one row per Voted event, including relayed voteBySig)
// milestone.yesVotes / noVotes equal the sum of vote.weight per milestone and support.
export const vote = onchainTable(
  "vote",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    milestoneIndex: t.integer().notNull(),
    voter: t.hex().notNull(),
    support: t.boolean().notNull(),
    weight: t.bigint().notNull(),
    txFrom: t.hex().notNull(), // the relayer for voteBySig, else the voter
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
    voterIdx: index().on(table.voter),
    projectMilestoneIdx: index().on(table.projectId, table.milestoneIndex),
  }),
);

// 3. Positions (staking and yield per investor per project)
export const position = onchainTable(
  "position",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}:${escrowAddress}:${investor}`
    chainId: t.integer().notNull(),
    project: t.text().notNull(), // project.id
    investor: t.hex().notNull(),
    stakedBalance: t.bigint().notNull(),
    yieldClaimed: t.bigint().notNull(),
    tokensHeld: t.bigint().notNull().default(0n),
    tokensClaimed: t.bigint().notNull().default(0n),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.project),
    investorIdx: index().on(table.investor),
  }),
);

// 4. Deposits (crowdfunding contributions per investor per project)
export const deposit = onchainTable(
  "deposit",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}:${escrowAddress}:${investor}`
    chainId: t.integer().notNull(),
    project: t.text().notNull(), // project.id
    investor: t.hex().notNull(),
    invested: t.bigint().notNull(),
    refunded: t.bigint().notNull(),
    tokensClaimed: t.bigint().notNull().default(0n),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.project),
    investorIdx: index().on(table.investor),
  }),
);

// 5. Secondary Market (P2P Exchange Listings)
export const p2pListing = onchainTable(
  "p2p_listing",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}:${listingId}`
    chainId: t.integer().notNull(),
    seller: t.hex().notNull(),
    tokenAddress: t.hex().notNull(),
    tokenAmount: t.bigint().notNull(),
    priceInETH: t.bigint().notNull(),
    isActive: t.boolean().notNull(),
    buyer: t.hex(), // null until the listing is filled
    status: t.text().notNull().default("ACTIVE"), // 'ACTIVE' | 'FILLED' | 'CANCELLED'
    // project.id resolved through token_map; null when the listed token is not a project token
    // (createListing accepts any ERC20, such listings are still recorded).
    projectId: t.text(),
    createdAt: t.bigint().notNull().default(0n),
    createdBlock: t.bigint().notNull().default(0n),
    createdTxHash: t.hex(),
    filledAt: t.bigint(), // null until filled
    cancelledAt: t.bigint(), // null unless cancelled
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    sellerIdx: index().on(table.seller),
    tokenIdx: index().on(table.tokenAddress),
    projectIdx: index().on(table.projectId),
    chainStatusIdx: index().on(table.chainId, table.status),
  }),
);

// 5b. Completed P2P trades (one row per ListingFilled). token and amount come from the stored
// listing because the event does not carry them; fee and proceeds are computed, not emitted.
export const p2pTrade = onchainTable(
  "p2p_trade",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    listingId: t.text().notNull(), // p2p_listing.id (`${chainId}:${listingId}`)
    projectId: t.text(), // null for non-project tokens
    tokenAddress: t.hex().notNull(),
    seller: t.hex().notNull(),
    buyer: t.hex().notNull(),
    tokenAmount: t.bigint().notNull(),
    pricePaid: t.bigint().notNull(), // msg.value, from the event
    protocolFee: t.bigint().notNull(), // computed: price * 100 / 10000
    sellerProceeds: t.bigint().notNull(), // computed: price - protocolFee
    txFrom: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
    projectTimeIdx: index().on(table.projectId, table.timestamp),
    sellerIdx: index().on(table.seller),
    buyerIdx: index().on(table.buyer),
    listingIdx: index().on(table.listingId),
  }),
);

// 6. Sponsored gas (one row per relayer-paid action; gasSpent is cumulative per project)
export const sponsoredGas = onchainTable(
  "sponsored_gas",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    relayer: t.hex().notNull(),
    account: t.hex().notNull(),
    action: t.integer().notNull(), // 0 claim, 1 stake, 2 vote, 3 execute
    cost: t.bigint().notNull(),
    gasSpent: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
    accountIdx: index().on(table.account),
    relayerIdx: index().on(table.relayer),
  }),
);

// 7. Gas debt recovery / write-off history per project
export const gasDebt = onchainTable(
  "gas_debt",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    kind: t.text().notNull(), // 'recovered' | 'written_off'
    milestoneIndex: t.integer(), // null for write-offs
    amount: t.bigint().notNull(),
    outstanding: t.bigint(), // null for write-offs
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
  }),
);

// 8. Milestone freeze / unfreeze history per project
export const milestoneFreeze = onchainTable(
  "milestone_freeze",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    kind: t.text().notNull(), // 'frozen' | 'unfrozen'
    until: t.bigint(), // null for unfrozen
    totalFrozen: t.bigint().notNull(),
    // The event carries no actor, so this is the tx sender (not necessarily the Guardian).
    triggeredBy: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
  }),
);

// 9. Registry role changes (treasury / guardian), history
export const roleChange = onchainTable(
  "role_change",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    role: t.text().notNull(), // 'treasury' | 'guardian'
    kind: t.text().notNull(), // 'proposed' | 'changed'
    previousAddress: t.hex().notNull(), // proposed: current holder
    newAddress: t.hex().notNull(), // proposed: the proposed address
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
  }),
);

// 10. Relayer allowlist (current state)
export const relayerAllowlist = onchainTable(
  "relayer_allowlist",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}:${relayer}`
    chainId: t.integer().notNull(),
    relayer: t.hex().notNull(),
    allowed: t.boolean().notNull(),
    updatedBlock: t.bigint().notNull(),
    updatedTxHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
  }),
);

// 11. Registry settings (current state)
export const registrySetting = onchainTable(
  "registry_setting",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}:maxCostPerAction` | `${chainId}:l1Surcharge:${action}`
    chainId: t.integer().notNull(),
    setting: t.text().notNull(), // 'maxCostPerAction' | 'l1Surcharge'
    action: t.integer(), // only for l1Surcharge
    value: t.bigint().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
  }),
);

// 12. Resolves a project token (Transfer events carry no project) to its project.
export const tokenMap = onchainTable(
  "token_map",
  (t) => ({
    id: t.text().primaryKey(), // `${chainId}:${tokenAddress}`
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    escrowAddress: t.hex().notNull(),
    distributorAddress: t.hex().notNull(),
    developer: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
  }),
);

// 13. Developer transfer history (propose / accept). Proposals may come from the
// developer or the Guardian; txFrom shows which.
export const developerChange = onchainTable(
  "developer_change",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    kind: t.text().notNull(), // 'proposed' | 'accepted'
    oldDeveloper: t.hex().notNull(),
    newDeveloper: t.hex().notNull(),
    txFrom: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
    newDeveloperIdx: index().on(table.newDeveloper),
  }),
);

// 14. Lifecycle event history per project (one row per lifecycle event).
export const projectLifecycleEvent = onchainTable(
  "project_lifecycle_event",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(), // project.id
    // 'COMPLETED' | 'CANCELLED' | 'FEE_COLLECTED' | 'SHUTDOWN' | 'TOKEN_INVALIDATED'
    kind: t.text().notNull(),
    reason: t.text(), // CANCELLED only
    feeAmount: t.bigint(), // FEE_COLLECTED only
    raisedAtClose: t.bigint(), // FEE_COLLECTED only
    extractedEth: t.bigint(), // SHUTDOWN only
    burnedTokens: t.bigint(), // SHUTDOWN only
    stateAfter: t.text(), // project.state written by the handler; null when state is untouched
    txFrom: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
    projectKindIdx: index().on(table.projectId, table.kind),
  }),
);

// 15. Launch provenance (one row per project; id equals project.id).
export const projectLaunch = onchainTable(
  "project_launch",
  (t) => ({
    id: t.text().primaryKey(), // projectId(chainId, milestoneEscrow)
    chainId: t.integer().notNull(),
    factoryAddress: t.hex().notNull(),
    launcher: t.hex().notNull(), // factory msg.sender (ProjectLaunched.developer)
    txFrom: t.hex().notNull(), // tx sender; differs for contract wallets or relayed launches
    txHash: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    tokenAddress: t.hex().notNull(),
    escrowAddress: t.hex().notNull(),
    distributorAddress: t.hex().notNull(),
    routerAddress: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    launcherIdx: index().on(table.launcher),
    txFromIdx: index().on(table.txFrom),
  }),
);

// 16. Revenue payments (one row per RevenueRouter PaymentReceived). Raw wei only.
export const revenueRecord = onchainTable(
  "revenue_record",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    routerAddress: t.hex().notNull(),
    projectId: t.text().notNull(), // project.id
    payer: t.hex().notNull(), // PaymentReceived.customer
    txFrom: t.hex().notNull(),
    gross: t.bigint().notNull(), // amountPaid
    creatorCut: t.bigint().notNull(), // 24%
    investorCut: t.bigint().notNull(), // nominal 75%, as reported by the event
    platformFee: t.bigint().notNull(), // the Treasury's 1%
    // True when project.totalStaked > 0 at event time (investorCut went to the distributor).
    // False: the router added investorCut to creatorPendingFunds instead, although the
    // event still reports the nominal investorCut.
    routedToStakers: t.boolean().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
    projectTimeIdx: index().on(table.projectId, table.timestamp),
    payerIdx: index().on(table.payer),
  }),
);

// 17. Router claims (one row per FundsClaimed). The event does not say which kind of
// claim it was, so kind is derived: CREATOR when claimant equals the project's current
// developer (project.developer follows DeveloperTransferAccepted), otherwise TREASURY.
// UNKNOWN is reserved for when neither can be established. Limitation: a treasury address
// equal to the developer cannot be told apart and is recorded as CREATOR.
export const routerClaim = onchainTable(
  "router_claim",
  (t) => ({
    id: t.text().primaryKey(), // eventId(chainId, txHash, logIndex)
    chainId: t.integer().notNull(),
    routerAddress: t.hex().notNull(),
    projectId: t.text().notNull(), // project.id
    claimant: t.hex().notNull(),
    amount: t.bigint().notNull(),
    kind: t.text().notNull(), // CREATOR | TREASURY | UNKNOWN
    txFrom: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
    claimantIdx: index().on(table.claimant),
  }),
);

// 18. Running revenue totals per project (id equals project.id), created on first use.
export const projectRevenue = onchainTable(
  "project_revenue",
  (t) => ({
    id: t.text().primaryKey(), // project.id
    chainId: t.integer().notNull(),
    paymentCount: t.integer().notNull().default(0),
    totalGross: t.bigint().notNull().default(0n),
    totalCreatorCut: t.bigint().notNull().default(0n),
    totalInvestorCut: t.bigint().notNull().default(0n), // nominal
    totalToStakers: t.bigint().notNull().default(0n), // investorCut where routedToStakers
    totalRedirectedToCreator: t.bigint().notNull().default(0n), // investorCut where not
    totalPlatformFee: t.bigint().notNull().default(0n),
    totalCreatorClaimed: t.bigint().notNull().default(0n),
    totalTreasuryClaimed: t.bigint().notNull().default(0n),
    lastPaymentAt: t.bigint(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
  }),
);

// 19. UTC-month revenue rollup (raw wei) for reconciliation (API-50).
export const projectRevenueMonth = onchainTable(
  "project_revenue_month",
  (t) => ({
    id: t.text().primaryKey(), // `${projectId}:${YYYY-MM}`
    chainId: t.integer().notNull(),
    projectId: t.text().notNull(),
    month: t.text().notNull(), // YYYY-MM, UTC
    paymentCount: t.integer().notNull().default(0),
    gross: t.bigint().notNull().default(0n),
    creatorCut: t.bigint().notNull().default(0n),
    investorCut: t.bigint().notNull().default(0n),
    platformFee: t.bigint().notNull().default(0n),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectMonthIdx: index().on(table.projectId, table.month),
  }),
);
