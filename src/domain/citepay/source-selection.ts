import type { PaymentIntent } from "@/domain/payment-intent/types";
import { addDecimalStrings, compareDecimalStrings } from "@/lib/decimal";
import type {
  CitePaySelectedSource,
  CitePaySelectionInput,
  CitePaySelectionResult,
  CitePaySkippedSource,
  CitePaySourceCard
} from "./types";

export const citePayMockSources: CitePaySourceCard[] = [
  {
    id: "trusted-x402-verification-api",
    title: "Trusted Arc Testnet verification API",
    creatorName: "Verity API",
    recipient: "trusted-x402-api.demo",
    description: "Trusted paid API for premium verification data before an agent publishes a research thesis.",
    price: "0.08",
    currency: "USDC",
    scenario: "api_access",
    paymentRail: "arc_settlement_preview",
    tags: ["premium", "verification", "data", "agent", "research", "thesis"]
  },
  {
    id: "premium-evidence-bundle",
    title: "Premium evidence bundle",
    creatorName: "Evidence Vault",
    recipient: "premium-evidence-bundle.demo",
    description: "Higher-value source bundle that should pause autonomous USDC spend for operator review.",
    price: "0.25",
    currency: "USDC",
    scenario: "data_access",
    paymentRail: "mock_gateway_nanopayment",
    tags: ["premium", "evidence", "bundle", "source"]
  },
  {
    id: "market-data-note",
    title: "Market data note",
    creatorName: "Market Data API",
    recipient: "market-data-api.demo",
    description: "Paid market data note for trading and pricing context.",
    price: "0.05",
    currency: "USDC",
    scenario: "data_access",
    paymentRail: "future_x402_gateway_citation_payment",
    tags: ["market", "pricing", "trading"]
  },
  {
    id: "untrusted-scrape-cache",
    title: "Untrusted scrape cache",
    creatorName: "Blocked Source",
    recipient: "blocked-recipient.demo",
    description: "Denied source example for scraped or unverified cache content.",
    price: "0.04",
    currency: "USDC",
    scenario: "data_access",
    paymentRail: "arc_settlement_preview",
    tags: ["scraped", "cache"]
  },
  {
    id: "telemetry-attestation-note",
    title: "Telemetry attestation note",
    creatorName: "Telemetry Attestation",
    recipient: "telemetry-attestation.demo",
    description: "Machine telemetry attestation source for device provenance answers.",
    price: "0.03",
    currency: "USDC",
    scenario: "machine_to_machine",
    paymentRail: "mock_agent_wallet",
    tags: ["telemetry", "attestation", "device", "provenance"]
  }
];

export const citePayDemoPreset = {
  label: "Ignyte/Circle/Arc demo preset",
  agentId: "agent_ignyte_demo_001",
  query: "Research agent needs premium verification data, high-value evidence, telemetry attestation, and scraped cache context before publishing a thesis",
  budget: "0.40"
} as const;

const tokenPattern = /[a-z0-9]+/g;

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().match(tokenPattern) ?? []);
}

function relevanceScore(queryTokens: Set<string>, source: CitePaySourceCard): number {
  return source.tags.reduce((score, tag) => score + (queryTokens.has(tag.toLowerCase()) ? 1 : 0), 0);
}

export function mapSourceToPaymentIntent(input: {
  agentId: string;
  query: string;
  source: CitePaySourceCard;
  selectionRank: number;
}): PaymentIntent {
  return {
    agentId: input.agentId,
    intent: `Pay ${input.source.price} ${input.source.currency} to access ${input.source.creatorName} for ${input.source.title} in an AgentPay Guard flow about: ${input.query}`,
    amount: input.source.price,
    currency: input.source.currency,
    recipient: input.source.recipient,
    scenario: input.source.scenario,
    paymentRail: input.source.paymentRail,
    idempotencyKey: `agentpay-${input.agentId}-${input.source.id}-${input.selectionRank}`
  };
}

export function selectCitePaySources(input: CitePaySelectionInput): CitePaySelectionResult {
  const queryTokens = tokenize(input.query);
  const scored = input.sources.map((source, index) => ({
    source,
    sourceIndex: index,
    relevanceScore: relevanceScore(queryTokens, source)
  }));
  const relevant = scored
    .filter((item) => item.relevanceScore > 0)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || left.sourceIndex - right.sourceIndex);

  const selected: CitePaySelectedSource[] = [];
  const skipped: CitePaySkippedSource[] = scored
    .filter((item) => item.relevanceScore === 0)
    .map((item) => ({
      source: item.source,
      relevanceScore: item.relevanceScore,
      reason: "not_relevant"
    }));
  let totalProposedSpend = "0";

  for (const item of relevant) {
    const nextTotal = addDecimalStrings([totalProposedSpend, item.source.price]);
    if (nextTotal === null || compareDecimalStrings(nextTotal, input.budget) === 1) {
      skipped.push({
        source: item.source,
        relevanceScore: item.relevanceScore,
        reason: "budget_cap"
      });
      continue;
    }

    totalProposedSpend = nextTotal;
    selected.push({
      source: item.source,
      relevanceScore: item.relevanceScore,
      paymentIntent: mapSourceToPaymentIntent({
        agentId: input.agentId,
        query: input.query,
        source: item.source,
        selectionRank: selected.length + 1
      })
    });
  }

  return {
    selected,
    skipped,
    totalProposedSpend
  };
}
