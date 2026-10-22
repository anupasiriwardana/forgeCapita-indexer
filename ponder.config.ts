import { createConfig, factory } from "ponder";
import { parseAbiItem } from "viem";

// Import your ABI files
import FactoryJSON from "./abis/ForgeCapitaFactory.json";
import EscrowJSON from "./abis/MilestoneEscrow.json";
import TokenJSON from "./abis/ProjectToken.json";
import DistributorJSON from "./abis/DividendDistributor.json";
import RouterJSON from "./abis/RevenueRouter.json";
import P2PJSON from "./abis/P2PExchange.json";

const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
const P2P_ADDRESS = process.env.P2P_ADDRESS;

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    sepolia: {
      id: 11155111,
      rpc: process.env.PONDER_RPC_URL_11155111 || "https://sepolia.drpc.org",
      ethGetLogsBlockRange: 5000, // Forces Ponder to query in chunks of 5,000 blocks
    },
  },
  contracts: {
    ForgeCapitaFactory: {
      abi: FactoryJSON.abi,
      chain: "sepolia",
      address: FACTORY_ADDRESS,
      startBlock: 11962458,
    },
    P2PExchange: {
      abi: P2PJSON.abi,
      chain: "sepolia",
      address: P2P_ADDRESS,
      startBlock: 11962458,
    },
    // Dynamic Factory Contracts
    MilestoneEscrow: {
      abi: EscrowJSON.abi,
      chain: "sepolia",
      address: factory({
        address: FACTORY_ADDRESS,
        event: parseAbiItem("event ProjectLaunched(address indexed developer, address projectToken, address milestoneEscrow, address dividendDistributor, address revenueRouter)"),
        parameter: "milestoneEscrow",
      }),
    },
    ProjectToken: {
      abi: TokenJSON.abi,
      chain: "sepolia",
      address: factory({
        address: FACTORY_ADDRESS,
        event: parseAbiItem("event ProjectLaunched(address indexed developer, address projectToken, address milestoneEscrow, address dividendDistributor, address revenueRouter)"),
        parameter: "projectToken",
      }),
    },
    DividendDistributor: {
      abi: DistributorJSON.abi,
      chain: "sepolia",
      address: factory({
        address: FACTORY_ADDRESS,
        event: parseAbiItem("event ProjectLaunched(address indexed developer, address projectToken, address milestoneEscrow, address dividendDistributor, address revenueRouter)"),
        parameter: "dividendDistributor",
      }),
    },
    RevenueRouter: {
      abi: RouterJSON.abi,
      chain: "sepolia",
      address: factory({
        address: FACTORY_ADDRESS,
        event: parseAbiItem("event ProjectLaunched(address indexed developer, address projectToken, address milestoneEscrow, address dividendDistributor, address revenueRouter)"),
        parameter: "revenueRouter",
      }),
    },
  },
});