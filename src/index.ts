import { ponder } from "ponder:registry";
import {
    project,
    distributorMap,
    milestone,
    position,
    deposit,
    p2pListing,
} from "../ponder.schema";
import {
    projectId,
    distributorKey,
    milestoneId,
    positionId,
    depositId,
    listingId,
} from "./ids";

// ============================================================================
// 1. FACTORY EVENTS (Startups)
// ============================================================================
ponder.on("ForgeCapitaFactory:ProjectLaunched", async ({ event, context }) => {
    const chainId = context.chain.id;
    const id = projectId(chainId, event.args.milestoneEscrow);

    await context.db
        .insert(project)
        .values({
            id,
            chainId,
            escrowAddress: event.args.milestoneEscrow,
            tokenAddress: event.args.projectToken,
            distributorAddress: event.args.dividendDistributor,
            developer: event.args.developer,
            fundingGoal: 0n, // We can pull this dynamically if added to the event, or default it
            totalRaised: 0n,
            isFundingActive: true,
            isDeadlocked: false,
            createdAt: event.block.timestamp,
        })
        .onConflictDoNothing();

    await context.db
        .insert(distributorMap)
        .values({
            id: distributorKey(chainId, event.args.dividendDistributor),
            chainId,
            projectId: id,
            escrowAddress: event.args.milestoneEscrow,
        })
        .onConflictDoNothing();
});

// ============================================================================
// 2. ESCROW EVENTS (Crowdfunding & Governance)
// ============================================================================
ponder.on("MilestoneEscrow:DepositReceived", async ({ event, context }) => {
    const chainId = context.chain.id;
    const escrow = event.log.address;
    const pid = projectId(chainId, escrow);

    const existing = await context.db.find(project, { id: pid });
    if (!existing) return;

    await context.db
        .update(project, { id: pid })
        .set((row) => ({ totalRaised: row.totalRaised + event.args.amount }));

    await context.db
        .insert(deposit)
        .values({
            id: depositId(chainId, escrow, event.args.backer),
            chainId,
            project: pid,
            investor: event.args.backer,
            invested: event.args.amount,
            refunded: 0n,
        })
        .onConflictDoUpdate((row) => ({
            invested: row.invested + event.args.amount,
        }));
});

ponder.on("MilestoneEscrow:RefundClaimed", async ({ event, context }) => {
    const chainId = context.chain.id;
    const escrow = event.log.address;

    await context.db
        .insert(deposit)
        .values({
            id: depositId(chainId, escrow, event.args.backer),
            chainId,
            project: projectId(chainId, escrow),
            investor: event.args.backer,
            invested: 0n,
            refunded: event.args.amount,
        })
        .onConflictDoUpdate((row) => ({
            refunded: row.refunded + event.args.amount,
        }));
});

ponder.on("MilestoneEscrow:VotingStarted", async ({ event, context }) => {
    const chainId = context.chain.id;
    const escrow = event.log.address;

    await context.db
        .insert(milestone)
        .values({
            id: milestoneId(chainId, escrow, event.args.milestoneIndex),
            chainId,
            projectId: projectId(chainId, escrow),
            milestoneIndex: Number(event.args.milestoneIndex),
            isVotingOpen: true,
            isExecuted: false,
            yesVotes: 0n,
            noVotes: 0n,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:Voted", async ({ event, context }) => {
    const id = milestoneId(context.chain.id, event.log.address, event.args.milestoneIndex);

    const existing = await context.db.find(milestone, { id });
    if (!existing) return;

    await context.db.update(milestone, { id }).set((row) => ({
        yesVotes: event.args.support ? row.yesVotes + event.args.weight : row.yesVotes,
        noVotes: !event.args.support ? row.noVotes + event.args.weight : row.noVotes,
    }));
});

ponder.on("MilestoneEscrow:MilestoneExecuted", async ({ event, context }) => {
    const id = milestoneId(context.chain.id, event.log.address, event.args.milestoneIndex);

    const existing = await context.db.find(milestone, { id });
    if (!existing) return;

    await context.db.update(milestone, { id }).set({
        isVotingOpen: false,
        isExecuted: true,
    });
});

// ============================================================================
// 3. DISTRIBUTOR EVENTS (Staking & Yield)
// Events carry no project: resolve it from distributor address + chain.
// ============================================================================
ponder.on("DividendDistributor:Staked", async ({ event, context }) => {
    const chainId = context.chain.id;
    const mapping = await context.db.find(distributorMap, {
        id: distributorKey(chainId, event.log.address),
    });
    if (!mapping) return;

    await context.db
        .insert(position)
        .values({
            id: positionId(chainId, mapping.escrowAddress, event.args.user),
            chainId,
            project: mapping.projectId,
            investor: event.args.user,
            stakedBalance: event.args.amount,
            yieldClaimed: 0n,
        })
        .onConflictDoUpdate((row) => ({
            stakedBalance: row.stakedBalance + event.args.amount,
        }));
});

ponder.on("DividendDistributor:Withdrawn", async ({ event, context }) => {
    const chainId = context.chain.id;
    const mapping = await context.db.find(distributorMap, {
        id: distributorKey(chainId, event.log.address),
    });
    if (!mapping) return;

    await context.db
        .insert(position)
        .values({
            id: positionId(chainId, mapping.escrowAddress, event.args.user),
            chainId,
            project: mapping.projectId,
            investor: event.args.user,
            stakedBalance: 0n,
            yieldClaimed: 0n,
        })
        .onConflictDoUpdate((row) => ({
            stakedBalance:
                row.stakedBalance >= event.args.amount
                    ? row.stakedBalance - event.args.amount
                    : 0n,
        }));
});

ponder.on("DividendDistributor:YieldClaimed", async ({ event, context }) => {
    const chainId = context.chain.id;
    const mapping = await context.db.find(distributorMap, {
        id: distributorKey(chainId, event.log.address),
    });
    if (!mapping) return;

    await context.db
        .insert(position)
        .values({
            id: positionId(chainId, mapping.escrowAddress, event.args.user),
            chainId,
            project: mapping.projectId,
            investor: event.args.user,
            stakedBalance: 0n,
            yieldClaimed: event.args.amount,
        })
        .onConflictDoUpdate((row) => ({
            yieldClaimed: row.yieldClaimed + event.args.amount,
        }));
});

// ============================================================================
// 4. P2P EXCHANGE EVENTS (Secondary Market)
// ============================================================================
ponder.on("P2PExchange:ListingCreated", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(p2pListing)
        .values({
            id: listingId(chainId, event.args.listingId),
            chainId,
            seller: event.args.seller,
            tokenAddress: event.args.token,
            tokenAmount: event.args.amount,
            priceInETH: event.args.price,
            isActive: true,
            buyer: null,
        })
        .onConflictDoNothing();
});

ponder.on("P2PExchange:ListingFilled", async ({ event, context }) => {
    const id = listingId(context.chain.id, event.args.listingId);

    const existing = await context.db.find(p2pListing, { id });
    if (!existing) return;

    await context.db.update(p2pListing, { id }).set({
        isActive: false,
        buyer: event.args.buyer,
    });
});

ponder.on("P2PExchange:ListingCancelled", async ({ event, context }) => {
    const id = listingId(context.chain.id, event.args.listingId);

    const existing = await context.db.find(p2pListing, { id });
    if (!existing) return;

    await context.db.update(p2pListing, { id }).set({
        isActive: false,
    });
});
