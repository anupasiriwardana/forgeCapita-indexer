import { onchainTable } from "ponder";

// 1. Projects (Startups launched via Factory)
export const project = onchainTable("project", (t) => ({
  id: t.hex().primaryKey(), // The MilestoneEscrow address acts as the unique ID
  tokenAddress: t.hex().notNull(),
  distributorAddress: t.hex().notNull(),
  developer: t.hex().notNull(),
  fundingGoal: t.bigint().notNull(),
  totalRaised: t.bigint().notNull(),
  isFundingActive: t.boolean().notNull(),
  isDeadlocked: t.boolean().notNull(),
  createdAt: t.bigint().notNull(),
}));

// 2. Project Milestones
export const milestone = onchainTable("milestone", (t) => ({
  id: t.text().primaryKey(), // Format: `${escrowAddress}-${milestoneIndex}`
  projectId: t.hex().notNull(), // Maps back to project.id
  milestoneIndex: t.integer().notNull(),
  isVotingOpen: t.boolean().notNull(),
  isExecuted: t.boolean().notNull(),
  yesVotes: t.bigint().notNull(),
  noVotes: t.bigint().notNull(),
}));

// 3. Investors (Staking & Yield Tracking)
export const investor = onchainTable("investor", (t) => ({
  id: t.hex().primaryKey(), // Investor's MetaMask wallet address
  totalTokensStaked: t.bigint().notNull(),
  totalYieldClaimed: t.bigint().notNull(),
}));

// 4. Secondary Market (P2P Exchange Listings)
export const p2pListing = onchainTable("p2p_listing", (t) => ({
  id: t.text().primaryKey(), // The numeric listingId from the smart contract
  seller: t.hex().notNull(),
  tokenAddress: t.hex().notNull(),
  tokenAmount: t.bigint().notNull(),
  priceInETH: t.bigint().notNull(),
  isActive: t.boolean().notNull(),
  buyer: t.hex(), // Optional: Remains null until the listing is filled
}));