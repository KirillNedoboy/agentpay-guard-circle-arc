import type { PaymentIntent, PolicyDecision } from "./types";

export type ArcTestnetRoute = {
  networkName: "Arc Testnet";
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  assetSymbol: "USDC" | string;
  assetContractAddress: string;
  assetDecimals: number;
};

export type ArcTestnetSimulation = {
  status: "simulated" | "not_eligible" | "not_executed";
  broadcast: false;
  verificationStatus: "not_broadcast";
  route: ArcTestnetRoute;
  network: {
    name: "Arc Testnet";
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
  };
  asset: {
    symbol: "USDC";
    contractAddress: string;
    decimals: 6;
  };
  recipientId: string;
  amountUSDC: string;
  reason: string;
};

export const arcTestnetRoute: ArcTestnetRoute = {
  networkName: "Arc Testnet",
  chainId: 5042002,
  rpcUrl: "https://rpc.testnet.arc.io",
  explorerUrl: "https://testnet.arcscan.app",
  assetSymbol: "USDC",
  assetContractAddress: "0x3600000000000000000000000000000000000000",
  assetDecimals: 6
};

type SimulationInput = {
  intent: PaymentIntent;
  decision: PolicyDecision;
  route?: ArcTestnetRoute;
  adapterAvailable?: boolean;
};

function baseSimulation(intent: PaymentIntent, route: ArcTestnetRoute) {
  return {
    broadcast: false as const,
    verificationStatus: "not_broadcast" as const,
    route,
    network: {
      name: "Arc Testnet" as const,
      chainId: route.chainId,
      rpcUrl: route.rpcUrl,
      explorerUrl: route.explorerUrl
    },
    asset: {
      symbol: "USDC" as const,
      contractAddress: route.assetContractAddress,
      decimals: 6 as const
    },
    recipientId: intent.recipient,
    amountUSDC: intent.amount
  };
}

function isSupportedRoute(route: ArcTestnetRoute): boolean {
  return (
    route.networkName === "Arc Testnet" &&
    route.chainId === 5042002 &&
    route.assetSymbol === "USDC" &&
    route.assetContractAddress === "0x3600000000000000000000000000000000000000" &&
    route.assetDecimals === 6
  );
}

export function simulateArcTestnetSettlement({
  intent,
  decision,
  route = arcTestnetRoute,
  adapterAvailable = true
}: SimulationInput): ArcTestnetSimulation {
  const base = baseSimulation(intent, route);

  if (!adapterAvailable) {
    return {
      ...base,
      status: "not_executed",
      reason: "Arc Testnet simulation adapter is unavailable. Settlement was not executed and no funds moved."
    };
  }

  if (!isSupportedRoute(route) || intent.paymentRail !== "arc_settlement_preview" || intent.currency !== "USDC") {
    return {
      ...base,
      status: "not_eligible",
      reason: "Arc Testnet USDC simulation requires the supported Arc route and USDC asset. Settlement was not executed and no funds moved."
    };
  }

  if (decision.decision !== "ALLOW") {
    return {
      ...base,
      status: "not_eligible",
      reason: "Only an ALLOW decision can enter Arc Testnet simulation. Settlement was not executed and no funds moved."
    };
  }

  return {
    ...base,
    status: "simulated",
    reason: "Arc Testnet USDC route simulation completed. Settlement was not executed and no funds moved."
  };
}
