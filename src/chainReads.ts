// Fallback contract-state reads for RPCs that cannot serve eth_call at past blocks
// (IDX-55). No imports from ponder or viem at runtime so the classifier and the
// sanitizer can be unit tested in isolation (IDX-40).
//
// Handlers normally read contract state pinned to the event block, which is
// deterministic. Public RPCs prune historical state and reject such calls with
// "historical state ... is not available". withLatestFallback retries ONCE at the
// latest block, and ONLY when the failure is classified as a pruned-state error.
//
// VALID ONLY FOR VALUES THAT NEVER CHANGE after the event block, so latest equals
// the event-block value (contract: forgecapita-contracts/contracts/MilestoneEscrow.sol):
//   - fundingGoal, fundingDeadline: written once in initialize (lines 177-178)
//   - CLOSE_GRACE, REFUND_WINDOW, VOTING_PERIOD: constants
//   - ProjectToken name and symbol: set at construction/initialisation only
//   - milestones(i).description and .unlockPercentage: written once in initialize
//   - frozenAtVoteStart(i): set only in startMilestone (line 272), which cannot run
//     twice for one index (requires !isVotingOpen, and the index advances on execution)
//   - totalRaised: assigned only in closeFundingAndStart (line 245), guarded by
//     isFundingActive so it runs once; PlatformFeeCollected is emitted right after it
//
// NEVER use it for mutable values: balances, vote tallies, votingEndTime after a
// freeze, totalStaked, anything that a later transaction can change.
//
// Determinism trade-off: Ponder stores the result of the unpinned read in the RPC
// cache (ponder_sync). A re-sync that keeps the cache re-reads the same value; a
// wiped cache re-reads live. Because the values are immutable the result is the same
// either way. An archive-capable RPC remains the real fix for backfills.
//
// IDX-40 test cases:
//   isHistoricalStateError: true for "historical state ... is not available" (also
//   inside a nested cause/details), "missing trie node"; false for "execution
//   reverted", "returned no data", "header not found", timeout, rate limit, plain Error,
//   non-error values, and a cyclic cause chain (depth cap).
//   sanitizeReadErrorMessage: URL removed, whitespace collapsed, truncated to 160.

const MAX_DEPTH = 5;
const MAX_REASON_LENGTH = 160;

const FIELDS = ["message", "shortMessage", "details"] as const;

function collectTexts(error: unknown, depth: number, out: string[]): void {
    if (depth > MAX_DEPTH || error === null || error === undefined) return;
    if (typeof error === "string") {
        out.push(error);
        return;
    }
    if (typeof error !== "object") return;
    for (const field of FIELDS) {
        if (field in error) {
            const value: unknown = (error as Record<string, unknown>)[field];
            if (typeof value === "string") out.push(value);
        }
    }
    if ("cause" in error) {
        collectTexts((error as Record<string, unknown>).cause, depth + 1, out);
    }
}

function matchesHistoricalState(text: string): boolean {
    const lower = text.toLowerCase();
    return (
        (lower.includes("historical state") && lower.includes("not available")) ||
        lower.includes("missing trie node") ||
        lower.includes("state already discarded") ||
        lower.includes("old data not available due to pruning") ||
        lower.includes("state is not available") ||
        lower.includes("required historical state unavailable") ||
        lower.includes("state pruned") ||
        lower.includes("pruned state") ||
        lower.includes("data pruned")
    );
}

// True when the RPC cannot serve state at a past block. Conservative: reverts, empty
// returns, missing blocks, rate limits, timeouts and generic fetch errors are false.
export function isHistoricalStateError(error: unknown): boolean {
    const texts: string[] = [];
    collectTexts(error, 0, texts);
    return texts.some(matchesHistoricalState);
}

// Short, log-safe reason: first message only, URLs stripped, never request/url/body.
export function sanitizeReadErrorMessage(error: unknown): string {
    const texts: string[] = [];
    if (typeof error === "object" && error !== null && "shortMessage" in error) {
        const short: unknown = (error as Record<string, unknown>).shortMessage;
        if (typeof short === "string") texts.push(short);
    }
    collectTexts(error, 0, texts);
    const first = texts.find((t) => t.trim().length > 0);
    if (first === undefined) return "unknown error";
    const firstLine = first.split(/\r?\n/)[0] ?? "";
    const cleaned = firstLine
        .replace(/(?:https?|wss?):\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned.length > MAX_REASON_LENGTH
        ? `${cleaned.slice(0, MAX_REASON_LENGTH)}...`
        : cleaned;
}

export interface ReadLabel {
    event: string;
    chainId: number;
    functionName: string;
}

// Log dedup only; carries no indexing state.
const warned = new Set<string>();

// Runs the pinned read; on a pruned-state error only, logs one warning per
// chain+function and runs the latest-block read. Any other error is rethrown
// unchanged. Only for never-changing values (see top of file).
export async function withLatestFallback<T>(
    label: ReadLabel,
    pinnedFn: () => Promise<T>,
    latestFn: () => Promise<T>,
): Promise<T> {
    try {
        return await pinnedFn();
    } catch (error) {
        if (!isHistoricalStateError(error)) throw error;
        const key = `${label.chainId}:${label.functionName}`;
        if (!warned.has(key)) {
            warned.add(key);
            console.warn(
                `[chainReads] pinned read unavailable, using latest for immutable value: event=${label.event} chain=${label.chainId} fn=${label.functionName} reason=${sanitizeReadErrorMessage(error)}`,
            );
        }
        return await latestFn();
    }
}
