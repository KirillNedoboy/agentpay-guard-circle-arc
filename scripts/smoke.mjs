const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const timestamp = Date.now();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const cases = [
  {
    name: "ALLOW",
    expectedDecision: "ALLOW",
    intent: {
      agentId: "agent_smoke_allow_001",
      intent: "Pay for trusted x402-style verification data.",
      amount: "0.08",
      currency: "USDC",
      recipient: "trusted-x402-api.demo",
      scenario: "api_access",
      paymentRail: "mock_x402_service"
    }
  },
  {
    name: "REVIEW",
    expectedDecision: "REVIEW",
    intent: {
      agentId: "agent_smoke_review_001",
      intent: "Pay for a premium evidence bundle.",
      amount: "0.25",
      currency: "USDC",
      recipient: "premium-evidence-bundle.demo",
      scenario: "data_access",
      paymentRail: "mock_gateway_nanopayment"
    }
  },
  {
    name: "BLOCK",
    expectedDecision: "BLOCK",
    intent: {
      agentId: "agent_smoke_block_001",
      intent: "Pay for an unverified scrape cache.",
      amount: "0.04",
      currency: "USDC",
      recipient: "blocked-recipient.demo",
      scenario: "data_access",
      paymentRail: "arc_settlement_preview"
    }
  }
];

for (const testCase of cases) {
  const response = await fetch(`${baseUrl}/api/payment-intents/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...testCase.intent,
      idempotencyKey: `smoke-${timestamp}-${testCase.name.toLowerCase()}`
    })
  });
  const body = await response.json();

  assert(response.ok, `${testCase.name} request failed with ${response.status}.`);
  assert(body.decision === testCase.expectedDecision, `${testCase.name} returned ${body.decision}.`);
  assert(typeof body.auditId === "string", `${testCase.name} did not return an audit ID.`);
  assert(body.spendControls?.currency === "USDC", `${testCase.name} did not return a USDC spend-control envelope.`);
  assert(body.arcTestnetSimulation?.broadcast === false, `${testCase.name} reported a broadcast.`);
  assert(!/transactionHash|txHash|signature|privateKey/i.test(JSON.stringify(body)), `${testCase.name} returned execution-only evidence.`);
}

console.log("Smoke check passed: ALLOW, REVIEW, BLOCK, audit evidence, spend controls, and non-broadcast adapter preview.");
