import { ponder } from "ponder:registry";
import { project, milestone, investor, p2pListing } from "../ponder.schema";

// ============================================================================
// 1. FACTORY EVENTS (Startups)
// ============================================================================
ponder.on("ForgeCapitaFactory:ProjectLaunched", async ({ event, context }) => {
    await context.db.insert(project).values({
        id: event.args.milestoneEscrow,
        tokenAddress: event.args.projectToken,
        distributorAddress: event.args.dividendDistributor,
        developer: event.args.developer,
        fundingGoal: 0n, // We can pull this dynamically if added to the event, or default it
        totalRaised: 0n,
        isFundingActive: true,
        isDeadlocked: false,
        createdAt: event.block.timestamp,
    });
});

// ============================================================================
// 2. ESCROW EVENTS (Crowdfunding & Governance)
// ============================================================================
ponder.on("MilestoneEscrow:DepositReceived", async ({ event, context }) => {
    // Add the new deposit to the project's total raised
    await context.db
        .update(project, { id: event.log.address })
        .set((row) => ({ totalRaised: row.totalRaised + event.args.amount }));
});

ponder.on("MilestoneEscrow:VotingStarted", async ({ event, context }) => {
    const milestoneId = `${event.log.address}-${event.args.milestoneIndex}`;

    await context.db.insert(milestone).values({
        id: milestoneId,
        projectId: event.log.address,
        milestoneIndex: Number(event.args.milestoneIndex),
        isVotingOpen: true,
        isExecuted: false,
        yesVotes: 0n,
        noVotes: 0n,
    });
});

ponder.on("MilestoneEscrow:Voted", async ({ event, context }) => {
    const milestoneId = `${event.log.address}-${event.args.milestoneIndex}`;

    await context.db.update(milestone, { id: milestoneId }).set((row) => ({
        yesVotes: event.args.support ? row.yesVotes + event.args.weight : row.yesVotes,
        noVotes: !event.args.support ? row.noVotes + event.args.weight : row.noVotes,
    }));
});

ponder.on("MilestoneEscrow:MilestoneExecuted", async ({ event, context }) => {
    const milestoneId = `${event.log.address}-${event.args.milestoneIndex}`;

    await context.db.update(milestone, { id: milestoneId }).set({
        isVotingOpen: false,
        isExecuted: true,
    });
});

// ============================================================================
// 3. DISTRIBUTOR EVENTS (Staking & Yield)
// ============================================================================
ponder.on("DividendDistributor:Staked", async ({ event, context }) => {
    await context.db
        .insert(investor)
        .values({
            id: event.args.user,
            totalTokensStaked: event.args.amount,
            totalYieldClaimed: 0n,
        })
        .onConflictDoUpdate((row) => ({
            totalTokensStaked: row.totalTokensStaked + event.args.amount,
        }));
});

ponder.on("DividendDistributor:Withdrawn", async ({ event, context }) => {
    await context.db.update(investor, { id: event.args.user }).set((row) => ({
        totalTokensStaked: row.totalTokensStaked - event.args.amount,
    }));
});

ponder.on("DividendDistributor:YieldClaimed", async ({ event, context }) => {
    await context.db.update(investor, { id: event.args.user }).set((row) => ({
        totalYieldClaimed: row.totalYieldClaimed + event.args.amount,
    }));
});

// ============================================================================
// 4. P2P EXCHANGE EVENTS (Secondary Market)
// ============================================================================
ponder.on("P2PExchange:ListingCreated", async ({ event, context }) => {
    await context.db.insert(p2pListing).values({
        id: event.args.listingId.toString(),
        seller: event.args.seller,
        tokenAddress: event.args.token,
        tokenAmount: event.args.amount,
        priceInETH: event.args.price,
        isActive: true,
        buyer: null,
    });
});

ponder.on("P2PExchange:ListingFilled", async ({ event, context }) => {
    await context.db.update(p2pListing, { id: event.args.listingId.toString() }).set({
        isActive: false,
        buyer: event.args.buyer,
    });
});

ponder.on("P2PExchange:ListingCancelled", async ({ event, context }) => {
    await context.db.update(p2pListing, { id: event.args.listingId.toString() }).set({
        isActive: false,
    });
});