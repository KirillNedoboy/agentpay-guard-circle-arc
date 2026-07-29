const baseUrl = (process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const timestamp = Date.now();

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { response, body };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const health = await request("/api/health");
assert(health.response.ok, `Health check failed with ${health.response.status}.`);
assert(health.body.status === "ok", "Health response did not report status ok.");

const cases = [
  {
    name: "ALLOW",
    expectedDecision: "ALLOW",
    intent: {
      agentId: "agent_smoke_001",
      intent: "Pay for trusted verification data.",
      amount: "0.08",
      currency: "USDC",
      recipient: "trusted-x402-api.demo",
      scenario: "api_access",
      paymentRail: "arc_settlement_preview"
    }
  },
  {
    name: "REVIEW",
    expectedDecision: "REVIEW",
    intent: {
      agentId: "agent_smoke_001",
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
      agentId: "agent_smoke_001",
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
  const { response, body } = await request("/api/payment-intents/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...testCase.intent, idempotencyKey: `smoke-${timestamp}-${testCase.name.toLowerCase()}` })
  });

  assert(response.ok, `${testCase.name} request failed with ${response.status}.`);
  assert(body.decision === testCase.expectedDecision, `${testCase.name} returned ${body.decision}.`);
  assert(typeof body.auditId === "string", `${testCase.name} did not return audit evidence.`);
  assert(body.arcTestnetSimulation?.broadcast === false, `${testCase.name} reported a broadcast.`);
}

console.log("Smoke check passed: health, ALLOW, REVIEW, BLOCK, audit IDs, and non-broadcast simulation state.");
