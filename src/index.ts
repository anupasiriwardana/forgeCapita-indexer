import { ponder } from "ponder:registry";
import {
    project,
    distributorMap,
    milestone,
    position,
    deposit,
    p2pListing,
    tokenMap,
    sponsoredGas,
    gasDebt,
    milestoneFreeze,
    roleChange,
    relayerAllowlist,
    registrySetting,
} from "../ponder.schema";
import {
    projectId,
    distributorKey,
    milestoneId,
    positionId,
    depositId,
    listingId,
    eventId,
    tokenKey,
    relayerKey,
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

    await context.db
        .insert(tokenMap)
        .values({
            id: tokenKey(chainId, event.args.projectToken),
            chainId,
            projectId: id,
            escrowAddress: event.args.milestoneEscrow,
            distributorAddress: event.args.dividendDistributor,
            developer: event.args.developer,
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

// ============================================================================
// 5. V2 ESCROW EVENTS (Gasless relayer, gas debt, freeze)
// Written even when the project row is missing; history rows only.
// ============================================================================
ponder.on("MilestoneEscrow:SponsoredGas", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(sponsoredGas)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            projectId: projectId(chainId, event.log.address),
            relayer: event.args.relayer,
            account: event.args.account,
            action: Number(event.args.action),
            cost: event.args.cost,
            gasSpent: event.args.gasSpent,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

// Not derived from MilestoneExecuted.gasDebtRecouped, which would double count.
ponder.on("MilestoneEscrow:GasDebtRecovered", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(gasDebt)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            projectId: projectId(chainId, event.log.address),
            kind: "recovered",
            milestoneIndex: Number(event.args.milestoneIndex),
            amount: event.args.amount,
            outstanding: event.args.outstanding,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:GasDebtWrittenOff", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(gasDebt)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            projectId: projectId(chainId, event.log.address),
            kind: "written_off",
            milestoneIndex: null,
            amount: event.args.amount,
            outstanding: null,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:MilestonesFrozen", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(milestoneFreeze)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            projectId: projectId(chainId, event.log.address),
            kind: "frozen",
            until: event.args.until,
            totalFrozen: event.args.totalFrozen,
            // The event carries no actor: this is the tx sender, not necessarily the Guardian.
            triggeredBy: event.transaction.from,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:MilestonesUnfrozen", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(milestoneFreeze)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            projectId: projectId(chainId, event.log.address),
            kind: "unfrozen",
            until: null,
            totalFrozen: event.args.totalFrozen,
            // The event carries no actor: this is the tx sender, not necessarily the Guardian.
            triggeredBy: event.transaction.from,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

// ============================================================================
// 6. REGISTRY EVENTS (Relayer allowlist, roles, settings)
// ============================================================================
ponder.on("ForgeCapitaRegistry:RelayerSet", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(relayerAllowlist)
        .values({
            id: relayerKey(chainId, event.args.relayer),
            chainId,
            relayer: event.args.relayer,
            allowed: event.args.allowed,
            updatedBlock: event.block.number,
            updatedTxHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            allowed: event.args.allowed,
            updatedBlock: event.block.number,
            updatedTxHash: event.transaction.hash,
        });
});

ponder.on("ForgeCapitaRegistry:TreasuryProposed", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(roleChange)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            role: "treasury",
            kind: "proposed",
            previousAddress: event.args.currentTreasury,
            newAddress: event.args.proposed,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("ForgeCapitaRegistry:TreasuryChanged", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(roleChange)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            role: "treasury",
            kind: "changed",
            previousAddress: event.args.oldTreasury,
            newAddress: event.args.newTreasury,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("ForgeCapitaRegistry:GuardianProposed", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(roleChange)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            role: "guardian",
            kind: "proposed",
            previousAddress: event.args.currentGuardian,
            newAddress: event.args.proposed,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("ForgeCapitaRegistry:GuardianChanged", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(roleChange)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            role: "guardian",
            kind: "changed",
            previousAddress: event.args.oldGuardian,
            newAddress: event.args.newGuardian,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("ForgeCapitaRegistry:MaxCostPerActionSet", async ({ event, context }) => {
    const chainId = context.chain.id;

    await context.db
        .insert(registrySetting)
        .values({
            id: `${chainId}:maxCostPerAction`,
            chainId,
            setting: "maxCostPerAction",
            action: null,
            value: event.args.value,
        })
        .onConflictDoUpdate({ value: event.args.value });
});

ponder.on("ForgeCapitaRegistry:L1SurchargeSet", async ({ event, context }) => {
    const chainId = context.chain.id;
    const action = Number(event.args.action);

    await context.db
        .insert(registrySetting)
        .values({
            id: `${chainId}:l1Surcharge:${action}`,
            chainId,
            setting: "l1Surcharge",
            action,
            value: event.args.value,
        })
        .onConflictDoUpdate({ value: event.args.value });
});

// ============================================================================
// 7. PROJECT TOKEN TRANSFERS (tokensHeld / tokensClaimed)
// Relies on the Ponder indexed-once guarantee (like Staked/DepositReceived):
// the additive updates below are not idempotent on their own.
// The launch mint and the factory->escrow transfer are emitted before
// ProjectLaunched, so token_map is still empty for them and they are skipped.
// ============================================================================
ponder.on("ProjectToken:Transfer", async ({ event, context }) => {
    const chainId = context.chain.id;
    const { from, to, value } = event.args;

    const mapping = await context.db.find(tokenMap, {
        id: tokenKey(chainId, event.log.address),
    });
    if (!mapping) return;

    const escrowKey = mapping.escrowAddress.toLowerCase();
    const excluded = new Set<string>([
        "0x0000000000000000000000000000000000000000",
        escrowKey,
        mapping.distributorAddress.toLowerCase(),
    ]);
    // The address is typed as possibly undefined (it is read from the environment).
    const exchange = context.contracts.P2PExchange.address;
    if (exchange) excluded.add(exchange.toLowerCase());
    const fromKey = from.toLowerCase();
    const toKey = to.toLowerCase();
    const toTracked = !excluded.has(toKey);
    const fromTracked = !excluded.has(fromKey);

    // Escrow outflow to anyone but the developer is an investor claim. Known
    // limitation: a developer who is also a depositor cannot be told apart
    // from vesting by Transfer alone.
    const isClaim =
        fromKey === escrowKey && toTracked && toKey !== mapping.developer.toLowerCase();
    const claimed = isClaim ? value : 0n;

    if (toTracked) {
        await context.db
            .insert(position)
            .values({
                id: positionId(chainId, mapping.escrowAddress, to),
                chainId,
                project: mapping.projectId,
                investor: to,
                stakedBalance: 0n,
                yieldClaimed: 0n,
                tokensHeld: value,
                tokensClaimed: claimed,
            })
            .onConflictDoUpdate((row) => ({
                tokensHeld: row.tokensHeld + value,
                tokensClaimed: row.tokensClaimed + claimed,
            }));
    }

    if (isClaim) {
        await context.db
            .insert(deposit)
            .values({
                id: depositId(chainId, mapping.escrowAddress, to),
                chainId,
                project: mapping.projectId,
                investor: to,
                invested: 0n,
                refunded: 0n,
                tokensClaimed: value,
            })
            .onConflictDoUpdate((row) => ({
                tokensClaimed: row.tokensClaimed + value,
            }));
    }

    if (fromTracked) {
        // Never create a row for a sender; clamp to avoid underflow.
        const senderId = positionId(chainId, mapping.escrowAddress, from);
        const existing = await context.db.find(position, { id: senderId });
        if (existing) {
            await context.db.update(position, { id: senderId }).set((row) => ({
                tokensHeld: row.tokensHeld >= value ? row.tokensHeld - value : 0n,
            }));
        }
    }
});
