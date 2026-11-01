// Pure project lifecycle helpers. No imports from ponder or viem so the logic
// can be unit tested in isolation.
//
// The stored project.state is EVENT-DRIVEN only. Time-only transitions (for
// example the close grace expiring after the funding deadline) emit no event,
// so consumers must call fundingPhase() with the current time instead of
// trusting state alone. `completed` is always checked FIRST: a shut-down
// completed project also has projectCancelled=true on-chain but stays COMPLETED.

export type LifecycleState =
  | "FUNDING"
  | "ACTIVE"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "SHUTDOWN";

export type LifecycleEvent =
  | "FUNDING_CLOSED"
  | "COMPLETED"
  | "MILESTONE_FAILED"
  | "CANCELLED"
  | "SHUTDOWN";

export type FundingPhase = "OPEN" | "CLOSEABLE" | "REFUNDABLE" | "NOT_APPLICABLE";

export interface FundingPhaseInput {
  fundingDeadline: bigint;
  closeGrace: bigint;
  fundingClosed: boolean;
  goalReached: boolean;
  state: LifecycleState;
}

// Terminal rules: COMPLETED is never overwritten; SHUTDOWN overrides anything
// but COMPLETED; FUNDING_CLOSED only moves FUNDING to ACTIVE; FAILED/CANCELLED
// only replace FUNDING/ACTIVE (never each other, never SHUTDOWN).
export function nextLifecycleState(
  current: LifecycleState,
  event: LifecycleEvent,
): LifecycleState {
  if (current === "COMPLETED") return "COMPLETED";

  switch (event) {
    case "COMPLETED":
      return "COMPLETED";
    case "SHUTDOWN":
      return "SHUTDOWN";
    case "FUNDING_CLOSED":
      return current === "FUNDING" ? "ACTIVE" : current;
    case "MILESTONE_FAILED":
      return current === "FUNDING" || current === "ACTIVE" ? "FAILED" : current;
    case "CANCELLED":
      return current === "FUNDING" || current === "ACTIVE" ? "CANCELLED" : current;
  }
}

function isTerminal(state: LifecycleState): boolean {
  return (
    state === "COMPLETED" ||
    state === "FAILED" ||
    state === "CANCELLED" ||
    state === "SHUTDOWN"
  );
}

// Crowdfunding window as of `now` (unix seconds).
export function fundingPhase(now: bigint, input: FundingPhaseInput): FundingPhase {
  if (input.fundingClosed || isTerminal(input.state)) return "NOT_APPLICABLE";
  if (now <= input.fundingDeadline) return "OPEN";
  if (!input.goalReached) return "REFUNDABLE";
  if (now <= input.fundingDeadline + input.closeGrace) return "CLOSEABLE";
  return "REFUNDABLE";
}

// Refunds are open for failed/cancelled projects (refundDeadProject) and for
// crowdfunds that missed the goal or the close grace (refundFailedCrowdfund).
export function refundsOpenFor(now: bigint, input: FundingPhaseInput): boolean {
  if (input.state === "COMPLETED") return false;
  if (input.state === "FAILED" || input.state === "CANCELLED") return true;
  return fundingPhase(now, input) === "REFUNDABLE";
}

// Mirrors the contract's votingEndTime(i): start + period + time frozen since the vote began.
// The contract view stays authoritative; this is for updating stored values on freeze events.
export function projectedVotingEnd(
  votingStartTime: bigint,
  votingPeriod: bigint,
  totalFrozenNow: bigint,
  frozenAtVoteStart: bigint,
): bigint {
  const frozenSince =
    totalFrozenNow > frozenAtVoteStart ? totalFrozenNow - frozenAtVoteStart : 0n;
  return votingStartTime + votingPeriod + frozenSince;
}
