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

export function tokenKey(chainId: number, token: string): string {
  return `${chainId}:${token.toLowerCase()}`;
}

export function routerKey(chainId: number, router: string): string {
  return `${chainId}:${router.toLowerCase()}`;
}

// `${projectId}:${YYYY-MM}` for the per-month revenue rollup.
export function revenueMonthId(project: string, month: string): string {
  return `${project}:${month}`;
}

// UTC year-month (YYYY-MM) of a block timestamp in seconds. Pure arithmetic on the
// civil-from-days algorithm, so no Date, locale or timezone is involved.
export function monthKey(timestamp: bigint): string {
  const days = timestamp / 86400n;
  const z = days + 719468n;
  const era = z / 146097n;
  const doe = z - era * 146097n;
  const yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n;
  const doy = doe - (365n * yoe + yoe / 4n - yoe / 100n);
  const mp = (5n * doy + 2n) / 153n;
  const month = mp < 10n ? mp + 3n : mp - 9n;
  const year = yoe + era * 400n + (month <= 2n ? 1n : 0n);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}`;
}

export function relayerKey(chainId: number, relayer: string): string {
  return `${chainId}:${relayer.toLowerCase()}`;
}
