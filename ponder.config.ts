import { createConfig, factory } from "ponder";
import { parseAbiItem } from "viem";

// Import your ABI files
import FactoryJSON from "./abis/ForgeCapitaFactory.json";
import EscrowJSON from "./abis/MilestoneEscrow.json";
import TokenJSON from "./abis/ProjectToken.json";
import DistributorJSON from "./abis/DividendDistributor.json";
import RouterJSON from "./abis/RevenueRouter.json";
import P2PJSON from "./abis/P2PExchange.json";

// Environment variables for Arbitrum Sepolia
const ARB_FACTORY_ADDRESS = process.env.ARB_FACTORY_ADDRESS as `0x${string}`;
const ARB_P2P_ADDRESS = process.env.ARB_P2P_ADDRESS as `0x${string}`;

// Environment variables for BSC Testnet
const BSC_FACTORY_ADDRESS = process.env.BSC_FACTORY_ADDRESS as `0x${string}`;
const BSC_P2P_ADDRESS = process.env.BSC_P2P_ADDRESS as `0x${string}`;

// Pre-parse the event signature used for the factory clones
const PROJECT_LAUNCHED_EVENT = parseAbiItem("event ProjectLaunched(address indexed developer, address projectToken, address milestoneEscrow, address dividendDistributor, address revenueRouter)");

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    arbitrumSepolia: {
      id: 421614,
      rpc: process.env.PONDER_RPC_URL_421614 || "https://sepolia-rollup.arbitrum.io/rpc",
      ethGetLogsBlockRange: 5000,
    },
    bscTestnet: {
      id: 97,
      rpc: process.env.PONDER_RPC_URL_97 || "https://data-seed-prebsc-1-s1.binance.org:8545",
      maxRequestsPerSecond: 3,
      ethGetLogsBlockRange: 2000,
    },
  },
  contracts: {
    ForgeCapitaFactory: {
      abi: FactoryJSON.abi,
      chain: {
        arbitrumSepolia: {
          address: ARB_FACTORY_ADDRESS,
          startBlock: 322758932
        },
        bscTestnet: {
          address: BSC_FACTORY_ADDRESS,
          startBlock: 138881864
        },
      }
    },
    P2PExchange: {
      abi: P2PJSON.abi,
      chain: {
        arbitrumSepolia: {
          address: ARB_P2P_ADDRESS,
          startBlock: 322758932
        },
        bscTestnet: {
          address: BSC_P2P_ADDRESS,
          startBlock: 138881864
        },
      }
    },
    // Dynamic Factory Contracts
    MilestoneEscrow: {
      abi: EscrowJSON.abi,
      chain: {
        arbitrumSepolia: {
          address: factory({
            address: ARB_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "milestoneEscrow",
          }),
        },
        bscTestnet: {
          address: factory({
            address: BSC_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "milestoneEscrow",
          }),
        },
      }
    },
    ProjectToken: {
      abi: TokenJSON.abi,
      chain: {
        arbitrumSepolia: {
          address: factory({
            address: ARB_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "projectToken",
          }),
        },
        bscTestnet: {
          address: factory({
            address: BSC_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "projectToken",
          }),
        },
      }
    },
    DividendDistributor: {
      abi: DistributorJSON.abi,
      chain: {
        arbitrumSepolia: {
          address: factory({
            address: ARB_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "dividendDistributor",
          }),
        },
        bscTestnet: {
          address: factory({
            address: BSC_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "dividendDistributor",
          }),
        },
      }
    },
    RevenueRouter: {
      abi: RouterJSON.abi,
      chain: {
        arbitrumSepolia: {
          address: factory({
            address: ARB_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "revenueRouter",
          }),
        },
        bscTestnet: {
          address: factory({
            address: BSC_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "revenueRouter",
          }),
        },
      }
    },
  },
});