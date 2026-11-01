# forgeCapita-indexer

`forgeCapita-indexer` is the on-chain data layer for the forgeCapita-v2 ecosystem, built using the Ponder TypeScript indexing framework. 

It continuously listens to the Arbitrum Sepolia and BSC Testnet for events emitted by the core forgeCapita smart contracts (`ForgeCapitaFactory`, `MilestoneEscrow`, `DividendDistributor`, `RevenueRouter`, and `P2PExchange`). It decodes these raw EVM events, transforms them using end-to-end type-safe indexing functions, and writes the structured data into a shared PostgreSQL (Neon) database. This provides an auto-generated GraphQL API that powers the Next.js frontend and Express.js off-chain backend.

## ABIs (v2)

`abis/<Name>.json` (synced Hardhat artifacts) is the source of truth; `abis/<Name>Abi.ts` is generated from it with `as const` typing and must not be hand-edited. To refresh after the contracts are recompiled:

```
# from the workspace root
node .claude/scripts/sync-abi.js indexer ForgeCapitaFactory MilestoneEscrow ProjectToken DividendDistributor RevenueRouter P2PExchange ForgeCapitaRegistry
# then, in forgecapita-indexer
npm run abis
```

## Schema guard

`ponder.config.ts` throws at load time unless the effective schema is `ponder` (`--schema ponder` CLI flag, otherwise `DATABASE_SCHEMA=ponder`), so the indexer can never write to `public`. This also applies to `ponder codegen`; set `DATABASE_SCHEMA=ponder` when running it.
