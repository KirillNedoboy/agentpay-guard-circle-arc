import { describe, expect, test } from "vitest";
import {
  buildAuditPreview,
  buildCctpRouteExplanation,
  buildDemoSummary,
  buildExecutionAuthorizationRows,
  buildNoAuthorizationExplanation,
  buildPilotCoverageRows,
  buildPilotMetricCards,
  buildPolicyEvidenceRows,
  buildProposedIntentRows,
  buildProgrammableEvidenceRows,
  buildQuickCaseDefinitions,
  buildQuickCaseTransition,
  buildRailPreviewRows,
  buildReasonCodeRows,
  buildReplayEvidenceView,
  buildSettlementBoundary,
  formatPilotP95,
  shortenFingerprint
} from "@/app/demo-metrics";
import type { AuditRecord } from "@/domain/audit/types";
import type { ReplayEvidence } from "@/domain/audit/replay-evidence";
import type { ExecutionAuthorization } from "@/domain/authorization/execution-authorization";
import type { PilotMetricsSummary } from "@/domain/observability/pilot-metrics";

function makeReplayEvidence(overrides: Partial<ReplayEvidence> = {}): ReplayEvidence {
  return {
    replayed: false,
    replayMismatch: false,
    policyChanged: false,
    storedIntentFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    currentIntentFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    storedPolicyVersion: "2",
    currentPolicyVersion: "2",
    storedPolicyFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    currentPolicyFingerprint: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ...overrides
  };
}

function makeAuthorization(overrides: Partial<ExecutionAuthorization> = {}): ExecutionAuthorization {
  return {
    authorizationType: "execution_authorization",
    version: "v1",
    authorizationId: "auth_1111111111111111111111111111111111111111111111111111111111111111",
    scope: "single_intent",
    intentId: "intent_x402",
    idempotencyKey: "judge-x402-api-micropayment-001",
    auditId: "audit_20260813_000001",
    agentId: "agent_ignyte_demo_001",
    recipient: "trusted-x402-api.demo",
    asset: "USDC",
    maxAmountUSDC: "0.08",
    paymentRail: "mock_x402_service",
    rail: "mock_x402_service",
    decision: "ALLOW",
    policyId: "default-agentpay-policy-v1",
    policyVersion: "2",
    policyFingerprint: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    issuedAt: "2026-08-13T12:00:00.000Z",
    expiresAt: "2026-08-13T12:05:00.000Z",
    executionScope: ["prepare", "simulate"],
    executionStatus: "not_executed",
    fundsMoved: false,
    ...overrides
  };
}

function makeMetrics(overrides: Partial<PilotMetricsSummary> = {}): PilotMetricsSummary {
  return {
    schemaVersion: "v1",
    canonicalIntentCount: 3,
    decisionCounts: { ALLOW: 2, REVIEW: 1, BLOCK: 0 },
    observedEvaluationAttemptCount: 5,
    replayAttemptCount: 2,
    exactReplayAttemptCount: 1,
    replayMismatchAttemptCount: 1,
    policyDriftAttemptCount: 0,
    unknownReplayStateAttemptCount: 0,
    authorizationIssuedAttemptCount: 3,
    p95PolicyEvaluationDurationMs: 1.5,
    reasonCodeCounts: { RECIPIENT_TRUSTED: 2, RECIPIENT_REVIEW_REQUIRED: 1 },
    policyGapSignals: { RECIPIENT_UNKNOWN_REQUIRES_REVIEW: 1 },
    evidenceCoverage: { intentFingerprintKnown: 3, policyFingerprintKnown: 2, policyVersionKnown: 3 },
    ...overrides
  };
}

describe("buildDemoSummary", () => {
  test("returns zeroed summary before any selection or evaluations", () => {
    expect(buildDemoSummary(null, [])).toEqual({
      proposedSpend: "0",
      allowedSpend: "0",
      reviewCount: 0,
      blockedCount: 0,
      approvedCount: 0,
      selectedCount: 0
    });
  });

  test("aggregates spend and decision counts from selected sources", () => {
    expect(
      buildDemoSummary(
        {
          selected: [{ source: { id: "s1", price: "0.25" } }, { source: { id: "s2", price: "0.80" } }, { source: { id: "s3", price: "0.35" } }],
          skipped: [],
          totalProposedSpend: "1.40"
        } as never,
        [
          { source: { id: "s1", price: "0.25" }, result: { decision: "ALLOW" } },
          { source: { id: "s2", price: "0.80" }, result: { decision: "REVIEW" } },
          { source: { id: "s3", price: "0.35" }, result: { decision: "BLOCK" } }
        ] as never
      )
    ).toEqual({
      proposedSpend: "1.40",
      allowedSpend: "0.25",
      reviewCount: 1,
      blockedCount: 1,
      approvedCount: 1,
      selectedCount: 3
    });
  });
});

describe("narrative evidence helpers", () => {
  const scenarios = [
    {
      label: "Trusted API",
      fileName: "scenario-allow-api.json",
      expectedDecision: "ALLOW",
      intent: {
        agentId: "agent_demo",
        intent: "Pay for trusted API",
        amount: "0.08",
        currency: "USDC",
        recipient: "trusted-x402-api.demo",
        scenario: "api_access",
        paymentRail: "mock_x402_service",
        idempotencyKey: "allow-001"
      }
    },
    {
      label: "Premium bundle",
      fileName: "scenario-review-machine.json",
      expectedDecision: "REVIEW",
      intent: {
        agentId: "agent_demo",
        intent: "Pay for premium bundle",
        amount: "0.25",
        currency: "USDC",
        recipient: "premium-evidence-bundle.demo",
        scenario: "data_access",
        paymentRail: "mock_gateway_nanopayment",
        idempotencyKey: "review-001"
      }
    },
    {
      label: "Blocked source",
      fileName: "scenario-block-risky.json",
      expectedDecision: "BLOCK",
      intent: {
        agentId: "agent_demo",
        intent: "Pay blocked source",
        amount: "0.04",
        currency: "USDC",
        recipient: "blocked-recipient.demo",
        scenario: "data_access",
        paymentRail: "arc_settlement_preview",
        idempotencyKey: "block-001"
      }
    }
  ] as const;

  test("defines generic ALLOW, CitePay REVIEW, and hard BLOCK quick cases", () => {
    expect(buildQuickCaseDefinitions(scenarios)).toMatchObject([
      { id: "allow", label: "Generic ALLOW", intent: scenarios[0].intent },
      { id: "review", label: "CitePay REVIEW", intent: scenarios[1].intent },
      { id: "block", label: "Hard BLOCK", intent: scenarios[2].intent }
    ]);
  });

  test("invalidates stale CitePay evidence before every quick case", () => {
    const quickCases = buildQuickCaseDefinitions(scenarios);

    for (const quickCase of quickCases) {
      const nextState = Object.assign(
        {
          citePaySelection: { selected: [{ source: { id: "stale-citepay-source" } }] },
          citePayEvaluations: [
            {
              paymentIntent: scenarios[1].intent,
              result: { decision: "REVIEW", auditId: "audit_stale_citepay" }
            }
          ],
          selectedReceiptAuditId: "audit_stale_citepay"
        },
        buildQuickCaseTransition(quickCase)
      );

      expect(nextState).toEqual({
        activeQuickCaseId: quickCase.id,
        form: quickCase.intent,
        result: null,
        citePaySelection: null,
        citePayEvaluations: [],
        selectedReceiptAuditId: null
      });
    }
  });

  test("maps proposed intent fields in reviewer order", () => {
    expect(
      buildProposedIntentRows({
        agentId: "agent_demo",
        intent: "Pay for trusted API",
        amount: "0.08",
        currency: "USDC",
        recipient: "trusted-x402-api.demo",
        scenario: "api_access",
        paymentRail: "mock_x402_service",
        idempotencyKey: "allow-001"
      })
    ).toEqual([
      ["Agent ID", "agent_demo"],
      ["Amount", "0.08 USDC"],
      ["Recipient", "trusted-x402-api.demo"],
      ["Scenario", "api_access"],
      ["Payment rail", "mock_x402_service"],
      ["Idempotency key", "allow-001"]
    ]);
  });

  test("returns a static future settlement boundary", () => {
    expect(buildSettlementBoundary()).toEqual({
      label: "Future / not executed in MVP",
      stages: ["Guard decision", "Future settlement adapter", "Arc / Circle Gateway / x402"]
    });
  });
});

describe("buildRailPreviewRows", () => {
  test("returns compact UI rows for preview-only rail evidence", () => {
    expect(
      buildRailPreviewRows({
        rail: "mock_gateway_nanopayment",
        networkLabel: "Circle Gateway Nanopayment preview",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "premium-evidence-bundle.demo",
        amountUSDC: "0.25",
        explanation: "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
      })
    ).toEqual([
      ["Rail", "Circle Gateway Nanopayment preview"],
      ["Asset", "USDC"],
      ["Mode", "mock_preview"],
      ["Recipient", "premium-evidence-bundle.demo"],
      ["Amount", "0.25 USDC"]
    ]);
  });

  test("returns no rows when the API response has no rail preview", () => {
    expect(buildRailPreviewRows(undefined)).toEqual([]);
  });
});

describe("buildProgrammableEvidenceRows", () => {
  test("returns ordered CCTP route, fee, and wallet proposal evidence", () => {
    expect(
      buildProgrammableEvidenceRows(
        {
          rail: "mock_x402_service",
          networkLabel: "x402-compatible paid API",
          settlementAsset: "USDC",
          executionMode: "mock_preview",
          recipientId: "trusted-x402-api.demo",
          amountUSDC: "5.01",
          explanation: "Preview only.",
          cctpRoutePreview: {
            mode: "cctp_route_preview",
            sourceChain: "Ethereum",
            destinationChain: "Base",
            asset: "native USDC (proposed)",
            finalityMode: "fast-transfer",
            attestation: "not requested",
            walletControlModel: "developer-controlled",
            proposedAmountUSDC: "5.01",
            estimatedFeeUSDC: "0.02",
            totalProposedSpendUSDC: "5.03"
          }
        },
        {
          transferMode: "cctp",
          gasPaymentMode: "native-gas"
        }
      )
    ).toEqual([
      ["Transfer mode", "cctp"],
      ["Route", "Ethereum → Base"],
      ["Finality", "fast-transfer"],
      ["Attestation", "not requested"],
      ["Wallet control", "developer-controlled"],
      ["Proposed amount", "5.01 USDC"],
      ["Estimated fee", "0.02 USDC"],
      ["Total proposed spend", "5.03 USDC"],
      ["Gas payment", "native-gas"]
    ]);
  });

  test("returns authority evidence from ERC-20 preview context", () => {
    expect(
      buildProgrammableEvidenceRows({
        rail: "mock_x402_service",
        networkLabel: "x402-compatible paid API",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "trusted-x402-api.demo",
        amountUSDC: "5.01",
        explanation: "Preview only.",
        erc20AuthorityPreview: {
          mode: "erc20_authority_preview",
          operation: "approve",
          spender: "trusted-agent-service",
          suppliedAmountBaseUnits: "5010000",
          explanation: "Authority preview only."
        }
      })
    ).toEqual([
      ["Operation", "approve"],
      ["Spender", "trusted-agent-service"],
      ["Amount base units", "5010000"]
    ]);
  });

  test("omits execution-only language from evidence rows", () => {
    const rows = buildProgrammableEvidenceRows(undefined);

    expect(rows).toEqual([]);
    expect(JSON.stringify(rows)).not.toMatch(/transactionHash|txHash|completed|settled|confirmed/i);
  });
});

describe("buildCctpRouteExplanation", () => {
  test("explains the proposed CCTP lane without tracker semantics", () => {
    expect(
      buildCctpRouteExplanation({
        rail: "mock_x402_service",
        networkLabel: "x402-compatible paid API",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "trusted-x402-api.demo",
        amountUSDC: "0.08",
        explanation: "Preview only.",
        cctpRoutePreview: {
          mode: "cctp_route_preview",
          sourceChain: "Ethereum",
          destinationChain: "Base",
          asset: "native USDC (proposed)",
          finalityMode: "standard",
          attestation: "not requested",
          proposedAmountUSDC: "0.08"
        }
      })
    ).toEqual({
      label: "Preview only",
      steps: [
        "Proposed Ethereum USDC",
        "CCTP burn — not executed",
        "Iris attestation — not requested / not verified here",
        "Proposed Base USDC mint — not executed"
      ]
    });
  });
});

describe("buildReasonCodeRows", () => {
  test("returns explicit reason code rows for policy evidence", () => {
    expect(buildReasonCodeRows(["RECIPIENT_TRUSTED", "AMOUNT_WITHIN_LIMIT", "RAIL_PREVIEW_ONLY"])).toEqual([
      ["Reason codes", "RECIPIENT_TRUSTED, AMOUNT_WITHIN_LIMIT, RAIL_PREVIEW_ONLY"]
    ]);
  });

  test("returns no rows when reason codes are absent", () => {
    expect(buildReasonCodeRows(undefined)).toEqual([]);
  });
});

describe("buildAuditPreview", () => {
  test("maps the existing audit record shape to TZ-relevant structured preview fields", () => {
    const preview = buildAuditPreview({
      eventType: "agent_payment_guard_evaluated",
      auditId: "audit_20260630_000001",
      timestamp: "2026-06-30T06:00:00.000Z",
      idempotencyKey: "ignyte-review-premium-dataset-001",
      agentId: "agent_ignyte_demo_001",
      intent: "Buy high-value premium evidence bundle before publishing an agent-generated thesis",
      amount: "0.25",
      currency: "USDC",
      recipient: "premium-evidence-bundle.demo",
      scenario: "data_access",
      paymentRail: "mock_gateway_nanopayment",
      decision: "REVIEW",
      riskScore: 60,
      policyId: "default-agentpay-policy-v1",
      policyVersion: "1",
      policyFingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      intentFingerprint: null,
      executionStatus: "not_executed",
      matchedRules: ["recipient_requires_review"],
      reasonCodes: ["RECIPIENT_REVIEW_REQUIRED", "AMOUNT_EXCEEDS_REVIEW_THRESHOLD", "RAIL_PREVIEW_ONLY"],
      reason: "Recipient requires operator review.",
      executionMode: "mock_preview",
      railPreview: {
        rail: "mock_gateway_nanopayment",
        networkLabel: "Circle Gateway Nanopayment preview",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "premium-evidence-bundle.demo",
        amountUSDC: "0.25",
        explanation: "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
      }
    });

    expect(preview).toEqual({
      intentId: "ignyte-review-premium-dataset-001",
      recipientLabel: "premium-evidence-bundle.demo",
      amountUSDC: "0.25",
      purpose: "premium_research_source",
      rail: "mock_gateway_nanopayment",
      decision: "REVIEW",
      matchedRules: ["recipient_requires_review"],
      reasonCodes: ["RECIPIENT_REVIEW_REQUIRED", "AMOUNT_EXCEEDS_REVIEW_THRESHOLD", "RAIL_PREVIEW_ONLY"],
      executionMode: "mock_preview",
      railPreview: {
        rail: "mock_gateway_nanopayment",
        networkLabel: "Circle Gateway Nanopayment preview",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "premium-evidence-bundle.demo",
        amountUSDC: "0.25",
        explanation: "Preview only. AgentPay Guard has not moved funds, signed a transaction, or called a live payment rail."
      }
    });
    expect(JSON.stringify(preview)).not.toMatch(/transactionHash|txHash|signature|privateKey|seedPhrase/i);
  });

  test("includes audit policy matches and programmable context when present", () => {
    const preview = buildAuditPreview({
      eventType: "agent_payment_guard_evaluated",
      auditId: "audit_programmable_000001",
      timestamp: "2026-07-16T12:00:00.000Z",
      idempotencyKey: "audit-programmable",
      agentId: "agent_cctp_demo_001",
      intent: "Propose standard CCTP USDC route",
      amount: "0.08",
      currency: "USDC",
      recipient: "trusted-x402-api.demo",
      scenario: "api_access",
      paymentRail: "mock_x402_service",
      decision: "ALLOW",
      riskScore: 10,
      policyId: "default-agentpay-policy-v1",
      policyVersion: "1",
      policyFingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      intentFingerprint: null,
      executionStatus: "not_executed",
      matchedRules: ["recipient_allowlisted", "scenario_allowed"],
      reasonCodes: ["RAIL_PREVIEW_ONLY"],
      reason: "Policy allows the proposal.",
      executionMode: "mock_preview",
      railPreview: {
        rail: "mock_x402_service",
        networkLabel: "x402-compatible paid API",
        settlementAsset: "USDC",
        executionMode: "mock_preview",
        recipientId: "trusted-x402-api.demo",
        amountUSDC: "0.08",
        explanation: "Preview only."
      },
      programmablePaymentContext: {
        transferMode: "cctp",
        sourceChain: "ethereum",
        destinationChain: "base",
        estimatedFee: "0.01",
        totalProposedSpendUSDC: "0.09"
      }
    });

    expect(preview).toMatchObject({
      matchedRules: ["recipient_allowlisted", "scenario_allowed"],
      programmablePaymentContext: {
        transferMode: "cctp",
        totalProposedSpendUSDC: "0.09"
      }
    });
  });

  test("returns null when there is no recent audit record", () => {
    expect(buildAuditPreview(undefined)).toBeNull();
  });

  test("maps legacy audit records that do not yet store rail preview fields", () => {
    const preview = buildAuditPreview({
      auditId: "audit_20260527_000001",
      timestamp: "2026-05-27T20:25:26.560Z",
      idempotencyKey: "legacy-demo-allow",
      agentId: "agent_market_data_001",
      intent: "Pay $0.005 USDC for market data API access",
      amount: "0.005",
      currency: "USDC",
      recipient: "market-data-api.demo",
      scenario: "api_access",
      paymentRail: "x402_gateway_nanopayment",
      decision: "ALLOW",
      riskScore: 10,
      policyId: "default-agentpay-policy-v1",
      matchedRules: ["recipient_allowlisted"],
      reason: "Recipient is allowlisted."
    } as AuditRecord);

    expect(preview).toMatchObject({
      intentId: "legacy-demo-allow",
      recipientLabel: "market-data-api.demo",
      amountUSDC: "0.005",
      purpose: "api_data_purchase",
      rail: "mock_x402_service",
      decision: "ALLOW",
      reasonCodes: [],
      executionMode: "mock_preview",
      railPreview: {
        rail: "mock_x402_service",
        amountUSDC: "0.005",
        recipientId: "market-data-api.demo"
      }
    });
  });
});

describe("buildReplayEvidenceView", () => {
  test("returns null without replay evidence", () => {
    expect(buildReplayEvidenceView(undefined)).toBeNull();
  });

  test("first evaluation", () => {
    expect(buildReplayEvidenceView(makeReplayEvidence())).toEqual({
      label: "First evaluation",
      detail: "This intent was evaluated for the first time.",
      isWarning: false
    });
  });

  test("exact replay", () => {
    expect(buildReplayEvidenceView(makeReplayEvidence({ replayed: true }))).toEqual({
      label: "Exact replay",
      detail: "Same intent and same policy; stored evidence reused.",
      isWarning: false
    });
  });

  test("replay mismatch", () => {
    expect(
      buildReplayEvidenceView(makeReplayEvidence({ replayed: true, replayMismatch: true }))
    ).toEqual({
      label: "Replay mismatch",
      detail: "The current request does not match the stored intent.",
      isWarning: true
    });
  });

  test("policy drift", () => {
    expect(
      buildReplayEvidenceView(makeReplayEvidence({ replayed: true, policyChanged: true }))
    ).toEqual({
      label: "Policy changed",
      detail: "Stored evidence differs from the active policy.",
      isWarning: true
    });
  });

  test("legacy unknown state", () => {
    expect(
      buildReplayEvidenceView(
        makeReplayEvidence({ replayed: true, replayMismatch: null, policyChanged: null })
      )
    ).toEqual({
      label: "Legacy evidence",
      detail: "Exact comparison unavailable.",
      isWarning: false
    });
  });
});

describe("buildPolicyEvidenceRows and shortenFingerprint", () => {
  const full = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

  test("shortens a long fingerprint deterministically without altering the original", () => {
    expect(shortenFingerprint(full)).toBe("sha256:abcdef01…6789");
    expect(shortenFingerprint(full)).toBe(shortenFingerprint(full));
  });

  test("leaves short or unusual values untouched", () => {
    expect(shortenFingerprint("sha256:abc")).toBe("sha256:abc");
    expect(shortenFingerprint(null)).toBe("Unavailable / legacy evidence");
  });

  test("exposes full values for accessibility", () => {
    const rows = buildPolicyEvidenceRows("default-agentpay-policy-v1", "2", full);
    expect(rows).toEqual([
      { label: "Policy ID", display: "default-agentpay-policy-v1", full: "default-agentpay-policy-v1" },
      { label: "Policy version", display: "2", full: "2" },
      { label: "Policy fingerprint", display: "sha256:abcdef01…6789", full }
    ]);
  });

  test("maps missing attribution to legacy wording", () => {
    const rows = buildPolicyEvidenceRows(undefined, null, null);
    expect(rows.every((row) => row.display === "Unavailable / legacy evidence")).toBe(true);
    expect(rows.every((row) => row.full === null)).toBe(true);
  });
});

describe("buildExecutionAuthorizationRows", () => {
  test("returns the full bounded-authorization evidence", () => {
    const rows = buildExecutionAuthorizationRows(makeAuthorization());
    const map = Object.fromEntries(rows);

    expect(map["Authorization ID"]).toBe("auth_1111111111111111111111111111111111111111111111111111111111111111");
    expect(map["Scope"]).toBe("single_intent");
    expect(map["Agent"]).toBe("agent_ignyte_demo_001");
    expect(map["Recipient"]).toBe("trusted-x402-api.demo");
    expect(map["Asset"]).toBe("USDC");
    expect(map["Maximum amount"]).toBe("0.08 USDC");
    expect(map["Policy version"]).toBe("2");
    expect(map["Execution scope"]).toBe("prepare, simulate");
    expect(map["Execution status"]).toBe("not_executed");
    expect(map["Funds moved"]).toBe("false");
  });

  test("returns no rows without an authorization", () => {
    expect(buildExecutionAuthorizationRows(null)).toEqual([]);
  });
});

describe("buildNoAuthorizationExplanation", () => {
  test("REVIEW and BLOCK produce the plain explanation", () => {
    expect(buildNoAuthorizationExplanation("REVIEW", makeReplayEvidence())).toEqual({
      message: "No Execution Authorization issued.",
      reason: "review-block"
    });
    expect(buildNoAuthorizationExplanation("BLOCK", makeReplayEvidence())).toEqual({
      message: "No Execution Authorization issued.",
      reason: "review-block"
    });
  });

  test("ALLOW with a replay mismatch explains the withheld authorization", () => {
    expect(
      buildNoAuthorizationExplanation(
        "ALLOW",
        makeReplayEvidence({ replayed: true, replayMismatch: true })
      )
    ).toEqual({ message: "Authorization withheld: replay mismatch.", reason: "mismatch" });
  });

  test("ALLOW with policy drift explains the withheld authorization", () => {
    expect(
      buildNoAuthorizationExplanation(
        "ALLOW",
        makeReplayEvidence({ replayed: true, policyChanged: true })
      )
    ).toEqual({
      message: "Authorization withheld: active policy differs from stored evidence.",
      reason: "policy-drift"
    });
  });

  test("returns null without a decision", () => {
    expect(buildNoAuthorizationExplanation(undefined, makeReplayEvidence())).toBeNull();
  });
});

describe("pilot metric presentation", () => {
  test("renders cards from the server summary", () => {
    const cards = buildPilotMetricCards(makeMetrics());
    const map = Object.fromEntries(cards.map((card) => [card.label, card.value]));

    expect(map["Canonical intents"]).toBe("3");
    expect(map["Evaluation attempts"]).toBe("5");
    expect(map["ALLOW"]).toBe("2");
    expect(map["REVIEW"]).toBe("1");
    expect(map["BLOCK"]).toBe("0");
    expect(map["Replay attempts"]).toBe("2");
    expect(map["Exact replays"]).toBe("1");
    expect(map["Replay mismatches"]).toBe("1");
    expect(map["Authorizations issued"]).toBe("3");
    expect(map["p95 policy evaluation"]).toBe("1.5 ms");
  });

  test("null p95 renders as no observations", () => {
    expect(formatPilotP95(null)).toBe("No observations yet");
    expect(formatPilotP95(0.932)).toBe("0.932 ms");
  });

  test("coverage rows use zero denominators when no canonical intents exist", () => {
    const rows = buildPilotCoverageRows(makeMetrics({ canonicalIntentCount: 0, evidenceCoverage: { intentFingerprintKnown: 0, policyFingerprintKnown: 0, policyVersionKnown: 0 } }));
    const map = Object.fromEntries(rows);

    expect(map["Intent fingerprints"]).toBe("0 / 0");
    expect(map["Policy fingerprints"]).toBe("0 / 0");
    expect(map["Policy versions"]).toBe("0 / 0");
  });

  test("coverage rows report known attribution and gap signals", () => {
    const rows = buildPilotCoverageRows(makeMetrics());
    const map = Object.fromEntries(rows);

    expect(map["Intent fingerprints"]).toBe("3 / 3");
    expect(map["Policy fingerprints"]).toBe("2 / 3");
    expect(map["Policy versions"]).toBe("3 / 3");
    expect(map["Policy-gap signals"]).toBe("1");
  });

  test("returns empty cards without metrics", () => {
    expect(buildPilotMetricCards(null)).toEqual([]);
    expect(buildPilotCoverageRows(null)).toEqual([]);
  });
});
