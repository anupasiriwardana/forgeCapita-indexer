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
    isDeadlocked: t.boolean().notNull(),
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
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    projectIdx: index().on(table.projectId),
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
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
    sellerIdx: index().on(table.seller),
    tokenIdx: index().on(table.tokenAddress),
  }),
);
