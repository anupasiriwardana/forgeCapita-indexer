import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import type { Context } from "hono";
import { and, asc, count, desc, eq, inArray, sum } from "ponder";
import type { AnyPgColumn } from "ponder";
import { projectId } from "../ids";

// Read-only REST aggregates over the indexed tables. GET only; mounted from
// src/api/index.ts. Every bigint leaves as a decimal string, every row-level item
// carries chainId, addresses are lowercase hex.

const {
  project,
  milestone,
  position,
  deposit,
  p2pListing,
  p2pTrade,
  sponsoredGas,
  gasDebt,
  projectLifecycleEvent,
  projectRevenue,
  projectRevenueMonth,
  routerMap,
  routerClaim,
} = schema;

// Chains the indexer is configured for (ponder.config.ts): Arbitrum Sepolia, BSC Testnet.
const SUPPORTED_CHAIN_IDS: readonly number[] = [421614, 97];

const PROJECT_STATES = ["FUNDING", "ACTIVE", "COMPLETED", "FAILED", "CANCELLED", "SHUTDOWN"] as const;
type ProjectState = (typeof PROJECT_STATES)[number];

const GAS_ACTIONS = [0, 1, 2, 3] as const;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const OVERVIEW_TTL_MS = 15_000;
const MAX_REVENUE_MONTHS = 120;
const MAX_DEBT_ROWS = 100;
const MAX_CREATOR_CLAIMS = 20;
const MAX_OFFSET = 10_000;

class BadRequestError extends Error {}
class NotFoundError extends Error {}

// ---------- input parsing ----------

function parseChainId(raw: string): number {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) throw new BadRequestError("Invalid chainId");
  const chainId = Number(raw);
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) throw new BadRequestError("Unsupported chainId");
  return chainId;
}

function parseOptionalChainId(raw: string | undefined): number | undefined {
  return raw === undefined ? undefined : parseChainId(raw);
}

function parseAddress(raw: string): string {
  if (!ADDRESS_PATTERN.test(raw)) throw new BadRequestError("Invalid address");
  return raw.toLowerCase();
}

// Non-negative decimal integer within [min, max]. Non-numeric or below min is a
// 400; above max is clamped to max (documented in the README).
function parseBoundedInt(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return fallback;
  if (!/^[0-9]{1,9}$/.test(raw)) throw new BadRequestError(`Invalid ${name}`);
  const value = Number(raw);
  if (value < min) throw new BadRequestError(`Invalid ${name}`);
  return Math.min(value, max);
}

function parsePaging(
  c: Context,
  defaultLimit: number,
  maxLimit: number,
): { limit: number; offset: number } {
  return {
    limit: parseBoundedInt(c.req.query("limit"), "limit", defaultLimit, 1, maxLimit),
    offset: parseBoundedInt(c.req.query("offset"), "offset", 0, 0, MAX_OFFSET),
  };
}

function sumStr(value: string | null | undefined): string {
  return value ?? "0";
}

// ---------- overview ----------

type RevenueStats = {
  paymentCount: number;
  totalGross: string;
  totalCreatorCut: string;
  totalToStakers: string;
  totalRedirectedToCreator: string;
  totalPlatformFee: string;
};

type ActionStats = { count: number; cost: string };

type ChainOverview = {
  chainId: number;
  projectsByState: Record<ProjectState, number>;
  activeVotes: number;
  totalRaised: string;
  platformFeesCollected: string;
  revenue: RevenueStats;
  sponsoredGas: {
    actionCount: number;
    totalCost: string;
    byAction: Record<string, ActionStats>;
  };
  gasDebt: { recovered: string; writtenOff: string };
  p2p: { tradeCount: number; volume: string; fees: string; activeListings: number };
};

type Overview = { generatedAt: number; chains: ChainOverview[] };

function emptyChain(chainId: number): ChainOverview {
  const projectsByState = Object.fromEntries(PROJECT_STATES.map((s) => [s, 0])) as Record<
    ProjectState,
    number
  >;
  const byAction: Record<string, ActionStats> = {};
  for (const action of GAS_ACTIONS) byAction[String(action)] = { count: 0, cost: "0" };
  return {
    chainId,
    projectsByState,
    activeVotes: 0,
    totalRaised: "0",
    platformFeesCollected: "0",
    revenue: {
      paymentCount: 0,
      totalGross: "0",
      totalCreatorCut: "0",
      totalToStakers: "0",
      totalRedirectedToCreator: "0",
      totalPlatformFee: "0",
    },
    sponsoredGas: { actionCount: 0, totalCost: "0", byAction },
    gasDebt: { recovered: "0", writtenOff: "0" },
    p2p: { tradeCount: 0, volume: "0", fees: "0", activeListings: 0 },
  };
}

function isProjectState(value: string): value is ProjectState {
  return (PROJECT_STATES as readonly string[]).includes(value);
}

async function buildOverview(chainFilter: number | undefined): Promise<Overview> {
  const chains = new Map<number, ChainOverview>();
  for (const id of chainFilter === undefined ? SUPPORTED_CHAIN_IDS : [chainFilter]) {
    chains.set(id, emptyChain(id));
  }
  const only = (column: AnyPgColumn) =>
    chainFilter === undefined ? undefined : eq(column, chainFilter);

  const [
    projectRows,
    voteRows,
    feeRows,
    revenueRows,
    gasRows,
    debtRows,
    tradeRows,
    listingRows,
  ] = await Promise.all([
    db
      .select({
        chainId: project.chainId,
        state: project.state,
        n: count(),
        raised: sum(project.totalRaised),
      })
      .from(project)
      .where(only(project.chainId))
      .groupBy(project.chainId, project.state),
    db
      .select({ chainId: milestone.chainId, n: count() })
      .from(milestone)
      .where(and(eq(milestone.isVotingOpen, true), only(milestone.chainId)))
      .groupBy(milestone.chainId),
    // Source is the FEE_COLLECTED lifecycle rows; should equal the sum of project.platformFee.
    db
      .select({ chainId: projectLifecycleEvent.chainId, fees: sum(projectLifecycleEvent.feeAmount) })
      .from(projectLifecycleEvent)
      .where(and(eq(projectLifecycleEvent.kind, "FEE_COLLECTED"), only(projectLifecycleEvent.chainId)))
      .groupBy(projectLifecycleEvent.chainId),
    db
      .select({
        chainId: projectRevenue.chainId,
        paymentCount: sum(projectRevenue.paymentCount),
        gross: sum(projectRevenue.totalGross),
        creatorCut: sum(projectRevenue.totalCreatorCut),
        toStakers: sum(projectRevenue.totalToStakers),
        redirected: sum(projectRevenue.totalRedirectedToCreator),
        platformFee: sum(projectRevenue.totalPlatformFee),
      })
      .from(projectRevenue)
      .where(only(projectRevenue.chainId))
      .groupBy(projectRevenue.chainId),
    db
      .select({
        chainId: sponsoredGas.chainId,
        action: sponsoredGas.action,
        n: count(),
        cost: sum(sponsoredGas.cost),
      })
      .from(sponsoredGas)
      .where(only(sponsoredGas.chainId))
      .groupBy(sponsoredGas.chainId, sponsoredGas.action),
    db
      .select({ chainId: gasDebt.chainId, kind: gasDebt.kind, amount: sum(gasDebt.amount) })
      .from(gasDebt)
      .where(only(gasDebt.chainId))
      .groupBy(gasDebt.chainId, gasDebt.kind),
    db
      .select({
        chainId: p2pTrade.chainId,
        n: count(),
        volume: sum(p2pTrade.pricePaid),
        fees: sum(p2pTrade.protocolFee),
      })
      .from(p2pTrade)
      .where(only(p2pTrade.chainId))
      .groupBy(p2pTrade.chainId),
    db
      .select({ chainId: p2pListing.chainId, n: count() })
      .from(p2pListing)
      .where(and(eq(p2pListing.status, "ACTIVE"), only(p2pListing.chainId)))
      .groupBy(p2pListing.chainId),
  ]);

  const raisedByChain = new Map<number, bigint>();
  for (const row of projectRows) {
    const chain = chains.get(row.chainId);
    if (!chain) continue;
    if (isProjectState(row.state)) chain.projectsByState[row.state] += row.n;
    raisedByChain.set(row.chainId, (raisedByChain.get(row.chainId) ?? 0n) + BigInt(sumStr(row.raised)));
  }
  for (const [chainId, raised] of raisedByChain) {
    const chain = chains.get(chainId);
    if (chain) chain.totalRaised = raised.toString();
  }

  for (const row of voteRows) {
    const chain = chains.get(row.chainId);
    if (chain) chain.activeVotes = row.n;
  }
  for (const row of feeRows) {
    const chain = chains.get(row.chainId);
    if (chain) chain.platformFeesCollected = sumStr(row.fees);
  }
  for (const row of revenueRows) {
    const chain = chains.get(row.chainId);
    if (!chain) continue;
    chain.revenue = {
      paymentCount: Number(sumStr(row.paymentCount)),
      totalGross: sumStr(row.gross),
      totalCreatorCut: sumStr(row.creatorCut),
      totalToStakers: sumStr(row.toStakers),
      totalRedirectedToCreator: sumStr(row.redirected),
      totalPlatformFee: sumStr(row.platformFee),
    };
  }

  const gasCostByChain = new Map<number, bigint>();
  for (const row of gasRows) {
    const chain = chains.get(row.chainId);
    if (!chain) continue;
    const cost = sumStr(row.cost);
    chain.sponsoredGas.actionCount += row.n;
    gasCostByChain.set(row.chainId, (gasCostByChain.get(row.chainId) ?? 0n) + BigInt(cost));
    chain.sponsoredGas.byAction[String(row.action)] = { count: row.n, cost };
  }
  for (const [chainId, cost] of gasCostByChain) {
    const chain = chains.get(chainId);
    if (chain) chain.sponsoredGas.totalCost = cost.toString();
  }

  for (const row of debtRows) {
    const chain = chains.get(row.chainId);
    if (!chain) continue;
    if (row.kind === "recovered") chain.gasDebt.recovered = sumStr(row.amount);
    else if (row.kind === "written_off") chain.gasDebt.writtenOff = sumStr(row.amount);
  }

  for (const row of tradeRows) {
    const chain = chains.get(row.chainId);
    if (!chain) continue;
    chain.p2p.tradeCount = row.n;
    chain.p2p.volume = sumStr(row.volume);
    chain.p2p.fees = sumStr(row.fees);
  }
  for (const row of listingRows) {
    const chain = chains.get(row.chainId);
    if (chain) chain.p2p.activeListings = row.n;
  }

  return { generatedAt: Math.floor(Date.now() / 1000), chains: [...chains.values()] };
}

// 15 s in-process cache keyed by the chain filter. One in-flight promise per key
// so concurrent misses share a single build; rejected builds are never stored.
const overviewCache = new Map<string, { expiresAt: number; value: Overview }>();
const overviewInflight = new Map<string, Promise<Overview>>();

function getOverview(chainFilter: number | undefined): Promise<Overview> {
  const key = chainFilter === undefined ? "all" : String(chainFilter);
  const hit = overviewCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
  const pending = overviewInflight.get(key);
  if (pending) return pending;

  const build = buildOverview(chainFilter)
    .then((value) => {
      overviewCache.set(key, { expiresAt: Date.now() + OVERVIEW_TTL_MS, value });
      return value;
    })
    .finally(() => {
      overviewInflight.delete(key);
    });
  overviewInflight.set(key, build);
  return build;
}

// ---------- routes ----------

export const statsRoutes = new Hono();

statsRoutes.onError((err, c) => {
  if (err instanceof BadRequestError) return c.json({ error: err.message }, 400);
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  console.error("stats route failed:", err instanceof Error ? err.message : "unknown error");
  return c.json({ error: "Internal server error" }, 500);
});

async function requireProject(id: string): Promise<void> {
  const rows = await db.select({ id: project.id }).from(project).where(eq(project.id, id)).limit(1);
  if (rows.length === 0) throw new NotFoundError("Project not found");
}

statsRoutes.get("/stats/overview", async (c) => {
  const overview = await getOverview(parseOptionalChainId(c.req.query("chainId")));
  c.header("Cache-Control", "public, max-age=15");
  return c.json(overview);
});

statsRoutes.get("/projects/:chainId/:address/revenue", async (c) => {
  const chainId = parseChainId(c.req.param("chainId"));
  const escrowAddress = parseAddress(c.req.param("address"));
  const id = projectId(chainId, escrowAddress);
  await requireProject(id);

  const [totalsRows, monthRows, routerRows, claimRows] = await Promise.all([
    db.select().from(projectRevenue).where(eq(projectRevenue.id, id)).limit(1),
    db
      .select()
      .from(projectRevenueMonth)
      .where(eq(projectRevenueMonth.projectId, id))
      .orderBy(desc(projectRevenueMonth.month))
      .limit(MAX_REVENUE_MONTHS),
    db
      .select({ routerAddress: routerMap.routerAddress })
      .from(routerMap)
      .where(eq(routerMap.projectId, id))
      .limit(1),
    db
      .select()
      .from(routerClaim)
      .where(and(eq(routerClaim.projectId, id), eq(routerClaim.kind, "CREATOR")))
      .orderBy(desc(routerClaim.timestamp), desc(routerClaim.id))
      .limit(MAX_CREATOR_CLAIMS),
  ]);
  const t = totalsRows[0];

  return c.json({
    chainId,
    projectId: id,
    escrowAddress,
    routerAddress: routerRows[0]?.routerAddress ?? null,
    claims: claimRows.map((r) => ({
      amount: r.amount.toString(),
      claimant: r.claimant,
      txHash: r.txHash,
      timestamp: r.timestamp.toString(),
    })),
    totals: {
      paymentCount: t?.paymentCount ?? 0,
      totalGross: (t?.totalGross ?? 0n).toString(),
      totalCreatorCut: (t?.totalCreatorCut ?? 0n).toString(),
      totalInvestorCut: (t?.totalInvestorCut ?? 0n).toString(),
      totalToStakers: (t?.totalToStakers ?? 0n).toString(),
      totalRedirectedToCreator: (t?.totalRedirectedToCreator ?? 0n).toString(),
      totalPlatformFee: (t?.totalPlatformFee ?? 0n).toString(),
      totalCreatorClaimed: (t?.totalCreatorClaimed ?? 0n).toString(),
      totalTreasuryClaimed: (t?.totalTreasuryClaimed ?? 0n).toString(),
      lastPaymentAt: t?.lastPaymentAt?.toString() ?? null,
    },
    months: monthRows.map((m) => ({
      month: m.month,
      paymentCount: m.paymentCount,
      gross: m.gross.toString(),
      creatorCut: m.creatorCut.toString(),
      investorCut: m.investorCut.toString(),
      platformFee: m.platformFee.toString(),
    })),
  });
});

type PositionKey = { chainId: number; project: string };

function compareKeys(a: PositionKey, b: PositionKey): number {
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  if (a.project === b.project) return 0;
  return a.project < b.project ? -1 : 1;
}

statsRoutes.get("/investors/:address/positions", async (c) => {
  const address = parseAddress(c.req.param("address"));
  const chainFilter = parseOptionalChainId(c.req.query("chainId"));
  const { limit, offset } = parsePaging(c, 50, 100);
  const window = offset + limit;

  // Page over the union of projects the investor has a deposit or a position in.
  // Each source is read as an id-only list in (chainId, project) order, capped at
  // offset + limit; the merged, de-duplicated list is sliced to the requested page,
  // and only then are full rows fetched for those (at most 100) project ids.
  const [depositKeys, positionKeys] = await Promise.all([
    db
      .select({ chainId: deposit.chainId, project: deposit.project })
      .from(deposit)
      .where(
        and(
          eq(deposit.investor, address as `0x${string}`),
          chainFilter === undefined ? undefined : eq(deposit.chainId, chainFilter),
        ),
      )
      .orderBy(asc(deposit.chainId), asc(deposit.project))
      .limit(window),
    db
      .select({ chainId: position.chainId, project: position.project })
      .from(position)
      .where(
        and(
          eq(position.investor, address as `0x${string}`),
          chainFilter === undefined ? undefined : eq(position.chainId, chainFilter),
        ),
      )
      .orderBy(asc(position.chainId), asc(position.project))
      .limit(window),
  ]);

  const unique = new Map<string, PositionKey>();
  for (const key of [...depositKeys, ...positionKeys]) unique.set(key.project, key);
  const pageKeys = [...unique.values()].sort(compareKeys).slice(offset, window);
  const pageIds = pageKeys.map((k) => k.project);

  if (pageIds.length === 0) return c.json({ address, positions: [], limit, offset });

  const [projectRows, depositRows, positionRows] = await Promise.all([
    db.select().from(project).where(inArray(project.id, pageIds)),
    db
      .select()
      .from(deposit)
      .where(and(eq(deposit.investor, address as `0x${string}`), inArray(deposit.project, pageIds))),
    db
      .select()
      .from(position)
      .where(and(eq(position.investor, address as `0x${string}`), inArray(position.project, pageIds))),
  ]);

  const projects = new Map(projectRows.map((p) => [p.id, p]));
  const deposits = new Map(depositRows.map((d) => [d.project, d]));
  const positions = new Map(positionRows.map((p) => [p.project, p]));

  const items = pageKeys.flatMap((key) => {
    const p = projects.get(key.project);
    if (!p) return [];
    const d = deposits.get(key.project);
    const pos = positions.get(key.project);
    return [
      {
        chainId: p.chainId,
        projectId: p.id,
        escrowAddress: p.escrowAddress,
        state: p.state,
        tokenSymbol: p.tokenSymbol,
        invested: (d?.invested ?? 0n).toString(),
        refunded: (d?.refunded ?? 0n).toString(),
        depositTokensClaimed: (d?.tokensClaimed ?? 0n).toString(),
        stakedBalance: (pos?.stakedBalance ?? 0n).toString(),
        yieldClaimed: (pos?.yieldClaimed ?? 0n).toString(),
        tokensHeld: (pos?.tokensHeld ?? 0n).toString(),
        tokensClaimed: (pos?.tokensClaimed ?? 0n).toString(),
      },
    ];
  });

  return c.json({ address, positions: items, limit, offset });
});

function parseAction(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-3]$/.test(raw)) throw new BadRequestError("Invalid action");
  return Number(raw);
}

statsRoutes.get("/projects/:chainId/:address/gas-ledger", async (c) => {
  const chainId = parseChainId(c.req.param("chainId"));
  const escrowAddress = parseAddress(c.req.param("address"));
  const { limit, offset } = parsePaging(c, 50, 200);
  const action = parseAction(c.req.query("action"));
  const id = projectId(chainId, escrowAddress);
  await requireProject(id);

  const [totalRows, newestGas, debtTotals, debtRows, sponsoredRows] = await Promise.all([
    db
      .select({ n: count(), cost: sum(sponsoredGas.cost) })
      .from(sponsoredGas)
      .where(eq(sponsoredGas.projectId, id)),
    db
      .select({ gasSpent: sponsoredGas.gasSpent })
      .from(sponsoredGas)
      .where(eq(sponsoredGas.projectId, id))
      .orderBy(desc(sponsoredGas.blockNumber), desc(sponsoredGas.id))
      .limit(1),
    db
      .select({ kind: gasDebt.kind, amount: sum(gasDebt.amount) })
      .from(gasDebt)
      .where(eq(gasDebt.projectId, id))
      .groupBy(gasDebt.kind),
    db
      .select()
      .from(gasDebt)
      .where(eq(gasDebt.projectId, id))
      .orderBy(desc(gasDebt.blockNumber), desc(gasDebt.id))
      .limit(MAX_DEBT_ROWS),
    db
      .select()
      .from(sponsoredGas)
      .where(
        and(
          eq(sponsoredGas.projectId, id),
          action === undefined ? undefined : eq(sponsoredGas.action, action),
        ),
      )
      .orderBy(desc(sponsoredGas.blockNumber), desc(sponsoredGas.id))
      .limit(limit)
      .offset(offset),
  ]);

  const totals = totalRows[0];
  const recovered = debtTotals.find((r) => r.kind === "recovered");
  const writtenOff = debtTotals.find((r) => r.kind === "written_off");

  return c.json({
    chainId,
    projectId: id,
    summary: {
      actionCount: totals?.n ?? 0,
      totalCost: sumStr(totals?.cost),
      // gasSpent is cumulative per project on-chain: take the newest row's value, never a sum.
      gasSpent: (newestGas[0]?.gasSpent ?? 0n).toString(),
      debtRecovered: sumStr(recovered?.amount),
      debtWrittenOff: sumStr(writtenOff?.amount),
      // Newest gas_debt row's outstanding; null when there is no row or it is a write-off.
      outstanding: debtRows[0]?.outstanding?.toString() ?? null,
    },
    sponsored: sponsoredRows.map((r) => ({
      id: r.id,
      chainId: r.chainId,
      action: r.action,
      account: r.account,
      relayer: r.relayer,
      cost: r.cost.toString(),
      gasSpent: r.gasSpent.toString(),
      blockNumber: r.blockNumber.toString(),
      timestamp: r.timestamp.toString(),
      txHash: r.txHash,
    })),
    debt: debtRows.map((r) => ({
      id: r.id,
      chainId: r.chainId,
      kind: r.kind,
      milestoneIndex: r.milestoneIndex,
      amount: r.amount.toString(),
      outstanding: r.outstanding?.toString() ?? null,
      blockNumber: r.blockNumber.toString(),
      timestamp: r.timestamp.toString(),
      txHash: r.txHash,
    })),
  });
});
