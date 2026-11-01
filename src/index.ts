import { ponder } from "ponder:registry";
import type { Context } from "ponder:registry";
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
    vote,
    developerChange,
    projectLifecycleEvent,
    projectLaunch,
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
import { nextLifecycleState, projectedVotingEnd } from "./projectState";
import type { LifecycleEvent, LifecycleState } from "./projectState";
import { MilestoneEscrowAbi } from "../abis/MilestoneEscrowAbi";
import { ProjectTokenAbi } from "../abis/ProjectTokenAbi";

// project.state is a text column; narrow it before handing it to the pure helper.
function toLifecycleState(value: string): LifecycleState {
    switch (value) {
        case "FUNDING":
        case "ACTIVE":
        case "COMPLETED":
        case "FAILED":
        case "CANCELLED":
        case "SHUTDOWN":
            return value;
        default:
            throw new Error(`Unknown project state: ${value}`);
    }
}

// All lifecycle logic lives in the pure helper; handlers only apply its result.
function advance(current: string, lifecycleEvent: LifecycleEvent): LifecycleState {
    return nextLifecycleState(toLifecycleState(current), lifecycleEvent);
}

// ============================================================================
// 1. FACTORY EVENTS (Startups)
// ============================================================================
ponder.on("ForgeCapitaFactory:ProjectLaunched", async ({ event, context }) => {
    const chainId = context.chain.id;
    const id = projectId(chainId, event.args.milestoneEscrow);

    // The clone is initialised in the launch tx, so state reads at this block are valid.
    // Errors propagate so Ponder retries; no fallback values are written.
    const escrowRead = {
        abi: MilestoneEscrowAbi,
        address: event.args.milestoneEscrow,
        blockNumber: event.block.number,
    } as const;
    const tokenRead = {
        abi: ProjectTokenAbi,
        address: event.args.projectToken,
        blockNumber: event.block.number,
    } as const;
    const [fundingGoal, fundingDeadline, closeGrace, refundWindow, votingPeriod, tokenName, tokenSymbol] =
        await Promise.all([
            context.client.readContract({ ...escrowRead, functionName: "fundingGoal" }),
            context.client.readContract({ ...escrowRead, functionName: "fundingDeadline" }),
            context.client.readContract({ ...escrowRead, functionName: "CLOSE_GRACE" }),
            context.client.readContract({ ...escrowRead, functionName: "REFUND_WINDOW" }),
            context.client.readContract({ ...escrowRead, functionName: "VOTING_PERIOD" }),
            context.client.readContract({ ...tokenRead, functionName: "name" }),
            context.client.readContract({ ...tokenRead, functionName: "symbol" }),
        ]);

    await context.db
        .insert(project)
        .values({
            id,
            chainId,
            escrowAddress: event.args.milestoneEscrow,
            tokenAddress: event.args.projectToken,
            distributorAddress: event.args.dividendDistributor,
            developer: event.args.developer,
            fundingGoal,
            totalRaised: 0n,
            isFundingActive: true,
            state: "FUNDING",
            fundingDeadline,
            closeGrace,
            refundWindow,
            votingPeriod,
            tokenName,
            tokenSymbol,
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

    // Provenance only: no call traces, so a contract caller's origin is not guessed.
    await context.db
        .insert(projectLaunch)
        .values({
            id,
            chainId,
            factoryAddress: event.log.address,
            launcher: event.args.developer,
            txFrom: event.transaction.from,
            txHash: event.transaction.hash,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            logIndex: event.log.logIndex,
            tokenAddress: event.args.projectToken,
            escrowAddress: event.args.milestoneEscrow,
            distributorAddress: event.args.dividendDistributor,
            routerAddress: event.args.revenueRouter,
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
    const index = event.args.milestoneIndex;

    const read = {
        abi: MilestoneEscrowAbi,
        address: escrow,
        blockNumber: event.block.number,
    } as const;
    const [milestoneTuple, frozenAtVoteStart, votingEndTime] = await Promise.all([
        context.client.readContract({ ...read, functionName: "milestones", args: [index] }),
        context.client.readContract({ ...read, functionName: "frozenAtVoteStart", args: [index] }),
        context.client.readContract({ ...read, functionName: "votingEndTime", args: [index] }),
    ]);
    const [description, unlockPercentage] = milestoneTuple;

    // onConflictDoNothing: a replay must never reset the vote tallies.
    await context.db
        .insert(milestone)
        .values({
            id: milestoneId(chainId, escrow, index),
            chainId,
            projectId: projectId(chainId, escrow),
            milestoneIndex: Number(index),
            isVotingOpen: true,
            isExecuted: false,
            yesVotes: 0n,
            noVotes: 0n,
            unlockPercentage: Number(unlockPercentage),
            description,
            votingStartTime: event.block.timestamp,
            frozenAtVoteStart,
            votingEndTime,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:Voted", async ({ event, context }) => {
    const chainId = context.chain.id;
    const escrow = event.log.address;

    // The vote row is always written, so a vote is never lost even if the milestone row is missing.
    await context.db
        .insert(vote)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            projectId: projectId(chainId, escrow),
            milestoneIndex: Number(event.args.milestoneIndex),
            voter: event.args.voter,
            support: event.args.support,
            weight: event.args.weight,
            txFrom: event.transaction.from,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();

    // Additive tally relies on Ponder's indexed-once guarantee. By construction
    // milestone.yesVotes/noVotes equal the sum of vote.weight per milestone and support.
    const id = milestoneId(chainId, escrow, event.args.milestoneIndex);
    const existing = await context.db.find(milestone, { id });
    if (existing) {
        await context.db.update(milestone, { id }).set((row) => ({
            yesVotes: event.args.support ? row.yesVotes + event.args.weight : row.yesVotes,
            noVotes: !event.args.support ? row.noVotes + event.args.weight : row.noVotes,
        }));
    }
});

ponder.on("MilestoneEscrow:MilestoneExecuted", async ({ event, context }) => {
    const chainId = context.chain.id;
    const escrow = event.log.address;
    const id = milestoneId(chainId, escrow, event.args.milestoneIndex);

    // gas_debt is written by GasDebtRecovered only; gasDebtRecouped is stored here for display.
    const existing = await context.db.find(milestone, { id });
    if (existing) {
        await context.db.update(milestone, { id }).set({
            isVotingOpen: false,
            isExecuted: true,
            executedAt: event.block.timestamp,
            amountReleased: event.args.amountReleased,
            tokensVested: event.args.tokensVested,
            gasDebtRecouped: event.args.gasDebtRecouped,
        });
    }

    const pid = projectId(chainId, escrow);
    const proj = await context.db.find(project, { id: pid });
    if (proj) {
        await context.db.update(project, { id: pid }).set({
            currentMilestoneIndex: Number(event.args.milestoneIndex) + 1,
        });
    }
});

ponder.on("MilestoneEscrow:PlatformFeeCollected", async ({ event, context }) => {
    const pid = projectId(context.chain.id, event.log.address);
    const proj = await context.db.find(project, { id: pid });
    if (!proj) return;

    // closeFundingAndStart overwrites totalRaised with the contract balance (no FundingClosed event).
    const totalRaised = await context.client.readContract({
        abi: MilestoneEscrowAbi,
        address: event.log.address,
        functionName: "totalRaised",
        blockNumber: event.block.number,
    });

    const stateAfter = advance(proj.state, "FUNDING_CLOSED");
    await context.db.update(project, { id: pid }).set({
        isFundingActive: false,
        state: stateAfter,
        fundingClosedAt: event.block.timestamp,
        platformFee: event.args.amount,
        totalRaised,
    });

    await context.db
        .insert(projectLifecycleEvent)
        .values({
            id: eventId(context.chain.id, event.transaction.hash, event.log.logIndex),
            chainId: context.chain.id,
            projectId: pid,
            kind: "FEE_COLLECTED",
            feeAmount: event.args.amount,
            raisedAtClose: totalRaised,
            stateAfter,
            txFrom: event.transaction.from,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:ProjectCompleted", async ({ event, context }) => {
    const pid = projectId(context.chain.id, event.log.address);
    const proj = await context.db.find(project, { id: pid });
    if (!proj) return;

    const stateAfter = advance(proj.state, "COMPLETED");
    await context.db.update(project, { id: pid }).set({ state: stateAfter });

    await context.db
        .insert(projectLifecycleEvent)
        .values({
            id: eventId(context.chain.id, event.transaction.hash, event.log.logIndex),
            chainId: context.chain.id,
            projectId: pid,
            kind: "COMPLETED",
            stateAfter,
            txFrom: event.transaction.from,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:MilestoneFailed", async ({ event, context }) => {
    const chainId = context.chain.id;
    const escrow = event.log.address;

    const mid = milestoneId(chainId, escrow, event.args.index);
    const existingMilestone = await context.db.find(milestone, { id: mid });
    if (existingMilestone) {
        await context.db.update(milestone, { id: mid }).set({
            isFailed: true,
            isVotingOpen: false,
            failedAt: event.block.timestamp,
        });
    }

    const pid = projectId(chainId, escrow);
    const proj = await context.db.find(project, { id: pid });
    if (!proj) return;

    await context.db.update(project, { id: pid }).set({
        state: advance(proj.state, "MILESTONE_FAILED"),
        failedMilestoneIndex: Number(event.args.index),
        cancelledAt: event.block.timestamp, // the contract sets cancelledAt on failure too
    });
});

ponder.on("MilestoneEscrow:ProjectCancelled", async ({ event, context }) => {
    const pid = projectId(context.chain.id, event.log.address);
    const proj = await context.db.find(project, { id: pid });
    if (!proj) return;

    const stateAfter = advance(proj.state, "CANCELLED");
    await context.db.update(project, { id: pid }).set({
        state: stateAfter,
        cancelledAt: event.block.timestamp,
    });

    await context.db
        .insert(projectLifecycleEvent)
        .values({
            id: eventId(context.chain.id, event.transaction.hash, event.log.logIndex),
            chainId: context.chain.id,
            projectId: pid,
            kind: "CANCELLED",
            reason: event.args.reason,
            stateAfter,
            txFrom: event.transaction.from,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:EmergencyShutdownTriggered", async ({ event, context }) => {
    const pid = projectId(context.chain.id, event.log.address);
    const proj = await context.db.find(project, { id: pid });
    if (!proj) return;

    // A shut-down completed project stays COMPLETED (enforced by nextLifecycleState).
    const stateAfter = advance(proj.state, "SHUTDOWN");
    await context.db.update(project, { id: pid }).set({
        isInvalidated: true,
        shutdownAt: event.block.timestamp,
        state: stateAfter,
    });

    await context.db
        .insert(projectLifecycleEvent)
        .values({
            id: eventId(context.chain.id, event.transaction.hash, event.log.logIndex),
            chainId: context.chain.id,
            projectId: pid,
            kind: "SHUTDOWN",
            extractedEth: event.args.extractedETH,
            burnedTokens: event.args.burnedTokens,
            stateAfter,
            txFrom: event.transaction.from,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:DeveloperTransferProposed", async ({ event, context }) => {
    const chainId = context.chain.id;
    const pid = projectId(chainId, event.log.address);
    const proj = await context.db.find(project, { id: pid });
    if (!proj) return;

    // Proposal only: project.developer changes on acceptance.
    await context.db
        .insert(developerChange)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            projectId: pid,
            kind: "proposed",
            oldDeveloper: event.args.oldDeveloper,
            newDeveloper: event.args.newDeveloper,
            txFrom: event.transaction.from, // the developer or the Guardian
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
});

ponder.on("MilestoneEscrow:DeveloperTransferAccepted", async ({ event, context }) => {
    const chainId = context.chain.id;
    const pid = projectId(chainId, event.log.address);
    const proj = await context.db.find(project, { id: pid });
    if (!proj) return;

    const mapping = await context.db.find(tokenMap, { id: tokenKey(chainId, proj.tokenAddress) });
    if (!mapping) return;

    await context.db
        .insert(developerChange)
        .values({
            id: eventId(chainId, event.transaction.hash, event.log.logIndex),
            chainId,
            projectId: pid,
            kind: "accepted",
            oldDeveloper: event.args.oldDeveloper,
            newDeveloper: event.args.newDeveloper,
            txFrom: event.transaction.from,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();

    await context.db.update(project, { id: pid }).set({ developer: event.args.newDeveloper });
    // ProjectToken:Transfer reads token_map.developer to recognise vesting transfers.
    await context.db
        .update(tokenMap, { id: mapping.id })
        .set({ developer: event.args.newDeveloper });
});

ponder.on("ProjectToken:TokenInvalidated", async ({ context, event }) => {
    const mapping = await context.db.find(tokenMap, {
        id: tokenKey(context.chain.id, event.log.address),
    });
    if (!mapping) return;

    await context.db.update(project, { id: mapping.projectId }).set({ isInvalidated: true });

    await context.db
        .insert(projectLifecycleEvent)
        .values({
            id: eventId(context.chain.id, event.transaction.hash, event.log.logIndex),
            chainId: context.chain.id,
            projectId: mapping.projectId,
            kind: "TOKEN_INVALIDATED",
            stateAfter: null, // this event does not change project.state
            txFrom: event.transaction.from,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
            txHash: event.transaction.hash,
        })
        .onConflictDoNothing();
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

    // Additive counter relies on Ponder's indexed-once guarantee.
    await context.db
        .update(project, { id: mapping.projectId })
        .set((row) => ({ totalStaked: row.totalStaked + event.args.amount }));
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

    // Additive counter relies on Ponder's indexed-once guarantee; clamped at 0n.
    await context.db.update(project, { id: mapping.projectId }).set((row) => ({
        totalStaked:
            row.totalStaked >= event.args.amount ? row.totalStaked - event.args.amount : 0n,
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

// Recomputes votingEndTime of the open milestone without RPC. The stored value tracks
// freeze events only; the contract's votingEndTime(i) stays authoritative.
async function refreshOpenVotingEnd(
    context: Context<"MilestoneEscrow:MilestonesFrozen" | "MilestoneEscrow:MilestonesUnfrozen">,
    escrow: `0x${string}`,
    totalFrozen: bigint,
): Promise<void> {
    const chainId = context.chain.id;
    const proj = await context.db.find(project, { id: projectId(chainId, escrow) });
    if (!proj) return;

    const id = milestoneId(chainId, escrow, proj.currentMilestoneIndex);
    const open = await context.db.find(milestone, { id });
    if (!open || !open.isVotingOpen) return;

    await context.db.update(milestone, { id }).set({
        votingEndTime: projectedVotingEnd(
            open.votingStartTime,
            proj.votingPeriod,
            totalFrozen,
            open.frozenAtVoteStart,
        ),
    });
}

ponder.on("MilestoneEscrow:MilestonesFrozen", async ({ event, context }) => {
    const chainId = context.chain.id;
    await refreshOpenVotingEnd(context, event.log.address, event.args.totalFrozen);

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
    await refreshOpenVotingEnd(context, event.log.address, event.args.totalFrozen);

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
