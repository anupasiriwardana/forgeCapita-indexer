# forgeCapita-indexer

`forgeCapita-indexer` is the on-chain data layer for the forgeCapita-v2 ecosystem, built using the Ponder TypeScript indexing framework. 

It continuously listens to the Ethereum Sepolia Testnet for events emitted by the core forgeCapita smart contracts (`ForgeCapitaFactory`, `MilestoneEscrow`, `DividendDistributor`, `RevenueRouter`, and `P2PExchange`). It decodes these raw EVM events, transforms them using end-to-end type-safe indexing functions, and writes the structured data into a shared PostgreSQL (Neon) database. This provides an auto-generated GraphQL API that powers the Next.js frontend and Express.js off-chain backend.