import { createConfig, factory } from "ponder";
import type { Address } from "viem";

import { ForgeCapitaFactoryAbi } from "./abis/ForgeCapitaFactoryAbi";
import { MilestoneEscrowAbi } from "./abis/MilestoneEscrowAbi";
import { ProjectTokenAbi } from "./abis/ProjectTokenAbi";
import { DividendDistributorAbi } from "./abis/DividendDistributorAbi";
import { RevenueRouterAbi } from "./abis/RevenueRouterAbi";
import { P2PExchangeAbi } from "./abis/P2PExchangeAbi";
import { ForgeCapitaRegistryAbi } from "./abis/ForgeCapitaRegistryAbi";

// Schema guard: the indexer must only ever write into the "ponder" schema,
// never the API's default "public" schema. Ponder resolves the schema as
// `--schema` CLI flag, else DATABASE_SCHEMA (dev falls back to "public").
// This file is loaded in the Ponder process, so process.argv is the CLI.
const REQUIRED_SCHEMA = "ponder";

function cliSchema(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--schema") return argv[i + 1];
    if (arg?.startsWith("--schema=")) return arg.slice("--schema=".length);
  }
  return undefined;
}

const effectiveSchema = cliSchema(process.argv) ?? process.env.DATABASE_SCHEMA;
if (effectiveSchema !== REQUIRED_SCHEMA) {
  throw new Error(
    `Refusing to start: indexer schema must be "${REQUIRED_SCHEMA}" (set DATABASE_SCHEMA=${REQUIRED_SCHEMA} or pass --schema ${REQUIRED_SCHEMA}).`,
  );
}

// RPC list per chain: primary + optional fallback, deduplicated, empty values
// dropped. A plain string[] is used (not viem fallback()) because Ponder's own
// transport balances and fails over across the array, retries with backoff and
// exposes per-host metrics. URLs may embed API keys, so errors never print them.
function rpcList(name: string, defaultUrl: string): string[] {
  const candidates = [process.env[name], process.env[`${name}_FALLBACK`]];
  const urls: string[] = [];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value || urls.includes(value)) continue;
    try {
      new URL(value);
    } catch {
      throw new Error(`Invalid RPC URL in ${name} or ${name}_FALLBACK (value hidden).`);
    }
    urls.push(value);
  }
  return urls.length > 0 ? urls : [defaultUrl];
}

// v2 deployment start blocks (first block of the v2 contracts on each chain).
// An empty value (for example `ARB_START_BLOCK=` copied into the env file) counts as unset, because
// Number("") is 0 and would make Ponder backfill the whole chain from genesis. A set value must be a
// positive integer, otherwise startup fails (the value is not printed).
function startBlockFromEnv(name: string, defaultBlock: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultBlock;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer block number (value hidden).`);
  }
  return parsed;
}

const ARB_START_BLOCK = startBlockFromEnv("ARB_START_BLOCK", 324727776);
const BSC_START_BLOCK = startBlockFromEnv("BSC_START_BLOCK", 140034644);

// Contract addresses (v2) from the environment.
const ARB_FACTORY_ADDRESS = process.env.ARB_FACTORY_ADDRESS as Address;
const ARB_P2P_ADDRESS = process.env.ARB_P2P_ADDRESS as Address;
const ARB_REGISTRY_ADDRESS = process.env.ARB_REGISTRY_ADDRESS as Address;
const BSC_FACTORY_ADDRESS = process.env.BSC_FACTORY_ADDRESS as Address;
const BSC_P2P_ADDRESS = process.env.BSC_P2P_ADDRESS as Address;
const BSC_REGISTRY_ADDRESS = process.env.BSC_REGISTRY_ADDRESS as Address;

// ProjectLaunched(address indexed developer, address projectToken, address milestoneEscrow,
// address dividendDistributor, address revenueRouter), taken from the typed v2 Factory ABI.
const PROJECT_LAUNCHED_EVENT = ForgeCapitaFactoryAbi.find(
  (item) => item.type === "event" && item.name === "ProjectLaunched",
);
if (!PROJECT_LAUNCHED_EVENT || PROJECT_LAUNCHED_EVENT.type !== "event") {
  throw new Error("ProjectLaunched event missing from ForgeCapitaFactory ABI");
}

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
  chains: {
    arbitrumSepolia: {
      id: 421614,
      rpc: rpcList("PONDER_RPC_URL_421614", "https://sepolia-rollup.arbitrum.io/rpc"),
      ethGetLogsBlockRange: 5000,
    },
    bscTestnet: {
      id: 97,
      rpc: rpcList("PONDER_RPC_URL_97", "https://data-seed-prebsc-1-s1.binance.org:8545"),
      // 1: the free Infura plan allows roughly 500 credits per second and an eth_getLogs call costs about
      // 255, so about 2 calls per second sustained (measured: a burst of 20 gave 14 ok and then 429).
      // 1 request per second with 1000-block ranges is still far faster than the chain produces blocks.
      maxRequestsPerSecond: 1,
      // 1000: the Infura BSC Testnet endpoint rejects eth_getLogs ranges above 1000 blocks
      // ("Exceeded max range limit for eth_getLogs: 1000"); smaller is always accepted by the others.
      ethGetLogsBlockRange: 1000,
    },
  },
  contracts: {
    ForgeCapitaFactory: {
      abi: ForgeCapitaFactoryAbi,
      chain: {
        arbitrumSepolia: {
          address: ARB_FACTORY_ADDRESS,
          startBlock: ARB_START_BLOCK
        },
        bscTestnet: {
          address: BSC_FACTORY_ADDRESS,
          startBlock: BSC_START_BLOCK
        },
      }
    },
    P2PExchange: {
      abi: P2PExchangeAbi,
      chain: {
        arbitrumSepolia: {
          address: ARB_P2P_ADDRESS,
          startBlock: ARB_START_BLOCK
        },
        bscTestnet: {
          address: BSC_P2P_ADDRESS,
          startBlock: BSC_START_BLOCK
        },
      }
    },
    ForgeCapitaRegistry: {
      abi: ForgeCapitaRegistryAbi,
      chain: {
        arbitrumSepolia: {
          address: ARB_REGISTRY_ADDRESS,
          startBlock: ARB_START_BLOCK,
        },
        bscTestnet: {
          address: BSC_REGISTRY_ADDRESS,
          startBlock: BSC_START_BLOCK,
        },
      }
    },
    // Dynamic Factory Contracts
    MilestoneEscrow: {
      abi: MilestoneEscrowAbi,
      chain: {
        arbitrumSepolia: {
          address: factory({
            address: ARB_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "milestoneEscrow",
          }),
          startBlock: ARB_START_BLOCK,
        },
        bscTestnet: {
          address: factory({
            address: BSC_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "milestoneEscrow",
          }),
          startBlock: BSC_START_BLOCK,
        },
      }
    },
    ProjectToken: {
      abi: ProjectTokenAbi,
      chain: {
        arbitrumSepolia: {
          address: factory({
            address: ARB_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "projectToken",
          }),
          startBlock: ARB_START_BLOCK,
        },
        bscTestnet: {
          address: factory({
            address: BSC_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "projectToken",
          }),
          startBlock: BSC_START_BLOCK,
        },
      }
    },
    DividendDistributor: {
      abi: DividendDistributorAbi,
      chain: {
        arbitrumSepolia: {
          address: factory({
            address: ARB_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "dividendDistributor",
          }),
          startBlock: ARB_START_BLOCK,
        },
        bscTestnet: {
          address: factory({
            address: BSC_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "dividendDistributor",
          }),
          startBlock: BSC_START_BLOCK,
        },
      }
    },
    RevenueRouter: {
      abi: RevenueRouterAbi,
      chain: {
        arbitrumSepolia: {
          address: factory({
            address: ARB_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "revenueRouter",
          }),
          startBlock: ARB_START_BLOCK,
        },
        bscTestnet: {
          address: factory({
            address: BSC_FACTORY_ADDRESS,
            event: PROJECT_LAUNCHED_EVENT,
            parameter: "revenueRouter",
          }),
          startBlock: BSC_START_BLOCK,
        },
      }
    },
  },
});