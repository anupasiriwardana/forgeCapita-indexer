// Pure id builders. Every id is chain-scoped so the same address or listing id
// on two chains (or two projects) never collides. Addresses are lowercased.

export function projectId(chainId: number, escrow: string): string {
  return `${chainId}:${escrow.toLowerCase()}`;
}

export function distributorKey(chainId: number, distributor: string): string {
  return `${chainId}:${distributor.toLowerCase()}`;
}

export function milestoneId(chainId: number, escrow: string, index: bigint | number): string {
  return `${chainId}:${escrow.toLowerCase()}:${index.toString()}`;
}

export function positionId(chainId: number, escrow: string, investor: string): string {
  return `${chainId}:${escrow.toLowerCase()}:${investor.toLowerCase()}`;
}

export function depositId(chainId: number, escrow: string, investor: string): string {
  return positionId(chainId, escrow, investor);
}

export function listingId(chainId: number, id: bigint | number): string {
  return `${chainId}:${id.toString()}`;
}

export function eventId(chainId: number, txHash: string, logIndex: number): string {
  return `${chainId}:${txHash.toLowerCase()}:${logIndex}`;
}
