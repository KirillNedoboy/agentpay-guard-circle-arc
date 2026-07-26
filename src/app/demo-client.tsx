"use client";

import { useEffect, useMemo, useState } from "react";
import {
  citePayDemoPreset,
  citePayMockSources,
  selectCitePaySources
} from "@/domain/citepay/source-selection";
import type { CitePaySelectedSource, CitePaySelectionResult } from "@/domain/citepay/types";
import type { AuditRecord } from "@/domain/audit/types";
import { buildAgentPayReceipt, type AgentPayReceipt } from "@/domain/payment-intent/receipt";
import type { CircleRailPreview, PaymentIntent } from "@/domain/payment-intent/types";
import {
  buildAuditPreview,
  buildCctpRouteExplanation,
  buildDemoSummary,
  buildProposedIntentRows,
  buildProgrammableEvidenceRows,
  buildQuickCaseDefinitions,
  buildRailPreviewRows,
  buildReasonCodeRows,
  buildSettlementBoundary,
  type QuickCaseDefinition
} from "./demo-metrics";

export type Scenario = {
  label: string;
  fileName: string;
  expectedDecision: string;
  intent: PaymentIntent;
};

type EvaluationResult = {
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  riskScore: number;
  reason: string;
  matchedRules: string[];
  reasonCodes?: string[];
  policyId: string;
  auditId: string | null;
  createdAt: string;
  executionMode?: CircleRailPreview["executionMode"];
  railPreview?: CircleRailPreview;
};

type FieldName =
  | "agentId"
  | "intent"
  | "amount"
  | "currency"
  | "recipient"
  | "scenario"
  | "paymentRail"
  | "idempotencyKey";

type CitePayEvaluatedSource = CitePaySelectedSource & {
  result: EvaluationResult;
};

const fieldLabels: Array<[FieldName, string]> = [
  ["agentId", "Agent ID"],
  ["intent", "Intent"],
  ["amount", "Amount"],
  ["currency", "Currency"],
  ["recipient", "Recipient"],
  ["scenario", "Scenario"],
  ["paymentRail", "Payment rail"],
  ["idempotencyKey", "Idempotency key"]
];

const architectureStages = ["AI Agent", "AgentPay Guard", "x402 / Circle Gateway", "Paid API / Service"];

export default function DemoClient({ scenarios }: { scenarios: Scenario[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedScenario = scenarios[selectedIndex] ?? scenarios[0];
  const [form, setForm] = useState<PaymentIntent>(selectedScenario.intent);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReceiptAuditId, setSelectedReceiptAuditId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable" | "error">("idle");
  const [citePayQuery, setCitePayQuery] = useState<string>(citePayDemoPreset.query);
  const [citePayBudget, setCitePayBudget] = useState<string>(citePayDemoPreset.budget);
  const [citePaySelection, setCitePaySelection] = useState<CitePaySelectionResult | null>(null);
  const [citePayEvaluations, setCitePayEvaluations] = useState<CitePayEvaluatedSource[]>([]);
  const [citePayIsSubmitting, setCitePayIsSubmitting] = useState(false);
  const [citePayError, setCitePayError] = useState<string | null>(null);
  const [activeQuickCaseId, setActiveQuickCaseId] = useState<QuickCaseDefinition["id"] | null>(null);

  useEffect(() => {
    setForm(selectedScenario.intent);
    setResult(null);
    setError(null);
    setSelectedReceiptAuditId(null);
    setCopyState("idle");
    setActiveQuickCaseId(null);
  }, [selectedScenario]);

  async function refreshAuditLog() {
    const response = await fetch("/api/audit-log", { cache: "no-store" });
    const data = (await response.json()) as { records: AuditRecord[] };
    setRecords(data.records);
  }

  useEffect(() => {
    void refreshAuditLog();
  }, []);

  function selectReceipt(auditId: string | null) {
    setSelectedReceiptAuditId(auditId);
    setCopyState("idle");
  }

  async function evaluateIntent(intent: PaymentIntent) {
    setIsSubmitting(true);
    setError(null);
    selectReceipt(null);
    try {
      const response = await fetch("/api/payment-intents/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent)
      });
      const data = (await response.json()) as EvaluationResult;
      setResult(data);
      selectReceipt(data.auditId);
      if (!response.ok) {
        setError(data.reason);
      }
      await refreshAuditLog();
    } catch {
      setError("Evaluation request failed locally.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function evaluate() {
    setActiveQuickCaseId(null);
    await evaluateIntent(form);
  }

  async function runQuickCase(quickCase: QuickCaseDefinition) {
    setActiveQuickCaseId(quickCase.id);
    setForm(quickCase.intent);
    setResult(null);
    await evaluateIntent(quickCase.intent);
    scrollToId("evidence");
  }

  function loadCitePayDemoPreset() {
    setCitePayQuery(citePayDemoPreset.query);
    setCitePayBudget(citePayDemoPreset.budget);
    setCitePaySelection(null);
    setCitePayEvaluations([]);
    setCitePayError(null);
    selectReceipt(null);
  }

  async function runCitePayFlow() {
    setCitePayIsSubmitting(true);
    setCitePayError(null);
    setCitePayEvaluations([]);
    setResult(null);
    setActiveQuickCaseId(null);
    selectReceipt(null);

    const selection = selectCitePaySources({
      agentId: citePayDemoPreset.agentId,
      query: citePayQuery,
      budget: citePayBudget,
      sources: citePayMockSources
    });
    setCitePaySelection(selection);

    try {
      const evaluations: CitePayEvaluatedSource[] = [];
      for (const selected of selection.selected) {
        const response = await fetch("/api/payment-intents/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selected.paymentIntent)
        });
        const data = (await response.json()) as EvaluationResult;
        evaluations.push({ ...selected, result: data });
        if (!response.ok) {
          setCitePayError(data.reason);
        }
      }
      setCitePayEvaluations(evaluations);
      const primaryEvaluation =
        evaluations.find((item) => item.result.decision === "BLOCK") ??
        evaluations.find((item) => item.result.decision === "REVIEW") ??
        evaluations.find((item) => item.result.decision === "ALLOW") ??
        null;
      selectReceipt(primaryEvaluation?.result.auditId ?? null);
      await refreshAuditLog();
    } catch {
      setCitePayError("CitePay evaluation failed locally.");
    } finally {
      setCitePayIsSubmitting(false);
    }
  }

  const decisionClass = useMemo(() => result?.decision.toLowerCase() ?? "empty", [result]);
  const quickCases = useMemo(() => buildQuickCaseDefinitions(scenarios), [scenarios]);
  const settlementBoundary = useMemo(() => buildSettlementBoundary(), []);
  const demoSummary = useMemo(() => buildDemoSummary(citePaySelection, citePayEvaluations), [citePaySelection, citePayEvaluations]);
  const auditPreview = useMemo(() => buildAuditPreview(records[0]), [records]);
  const selectedAuditRecord = useMemo(
    () => records.find((record) => record.auditId === selectedReceiptAuditId) ?? null,
    [records, selectedReceiptAuditId]
  );
  const agentPayReceipt = useMemo<AgentPayReceipt | null>(
    () => (selectedAuditRecord ? buildAgentPayReceipt(selectedAuditRecord) : null),
    [selectedAuditRecord]
  );
  const primaryEvaluation = useMemo(() => {
    const selectedEvaluation = citePayEvaluations.find(
      (item) => item.result.auditId === selectedReceiptAuditId
    );
    return selectedEvaluation ??
      citePayEvaluations.find((item) => item.result.decision === "BLOCK") ??
      citePayEvaluations.find((item) => item.result.decision === "REVIEW") ??
      citePayEvaluations.find((item) => item.result.decision === "ALLOW") ??
      null;
  }, [citePayEvaluations, selectedReceiptAuditId]);
  const primaryResult = result ?? primaryEvaluation?.result ?? null;
  const proposedIntent = primaryEvaluation?.paymentIntent ?? (result ? form : quickCases.find((item) => item.id === "review")?.intent ?? null);
  const proposedIntentRows = useMemo(() => buildProposedIntentRows(proposedIntent), [proposedIntent]);
  const latestRules = primaryResult?.matchedRules ?? [];
  const latestReasonCodes = primaryResult?.reasonCodes ?? [];
  const primaryOutcome = useMemo(() => {
    if (!primaryResult) {
      return {
        decision: "READY",
        riskScore: null,
        reason: "Run the CitePay flow or a quick case to produce an explainable policy decision.",
        auditId: "pending"
      };
    }

    return {
      decision: primaryResult.decision,
      riskScore: primaryResult.riskScore,
      reason: primaryResult.reason,
      auditId: primaryResult.auditId ?? "pending"
    };
  }, [primaryResult]);

  function scrollToId(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function runPrimaryDemo() {
    scrollToId("main-demo");
    void runCitePayFlow();
  }

  async function copyReceiptJson() {
    if (!agentPayReceipt) {
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setCopyState("unavailable");
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(agentPayReceipt, null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  function renderProgrammableEvidence(preview: CircleRailPreview | undefined, context?: AuditRecord["programmablePaymentContext"]) {
    const rows = buildProgrammableEvidenceRows(preview, context);
    const cctpRouteExplanation = buildCctpRouteExplanation(preview);
    if (!rows.length && !cctpRouteExplanation) {
      return null;
    }

    return (
      <section className="programmable-evidence" aria-label="Programmable payment evidence">
        <div className="programmable-evidence-head">
          <strong>Programmable payment evidence</strong>
          <span>Preview only</span>
        </div>
        {rows.length ? (
          <dl className="programmable-evidence-grid">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={label === "Operation" || label === "Spender" || label === "Amount base units" ? "mono-text" : ""}>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {cctpRouteExplanation ? (
          <div className="cctp-route-explanation">
            <strong>{cctpRouteExplanation.label}</strong>
            <ol>
              {cctpRouteExplanation.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
    );
  }

  function renderRailPreview(preview: CircleRailPreview | undefined, context?: AuditRecord["programmablePaymentContext"]) {
    const rows = buildRailPreviewRows(preview);
    if (!rows.length) {
      return null;
    }

    return (
      <div className="rail-preview" aria-label="Circle and Arc rail preview">
        <div className="rail-preview-head">
          <strong>Rail preview</strong>
          <span className={`execution-chip ${preview?.executionMode ?? "live_disabled"}`}>
            {preview?.executionMode ?? "live_disabled"}
          </span>
        </div>
        <dl className="rail-preview-grid">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={label === "Mode" || label === "Recipient" ? "mono-text" : ""}>{value}</dd>
            </div>
          ))}
        </dl>
        {renderProgrammableEvidence(preview, context)}
        <p>{preview?.explanation ?? "Live payment rail is disabled. This response is a preview, not settlement."}</p>
        <p className="rail-preview-boundary">No funds move in mock mode.</p>
      </div>
    );
  }

  function renderReasonCodes(reasonCodes: string[] | undefined) {
    const rows = buildReasonCodeRows(reasonCodes);
    if (!rows.length) {
      return null;
    }

    return rows.map(([label, value]) => (
      <div className="wide-proof-row" key={label}>
        <dt>{label}</dt>
        <dd className="rule-list-inline">{value}</dd>
      </div>
    ));
  }

  return (
    <main className="shell">
      <header className="topbar" aria-label="Demo status">
        <div>
          <strong>AgentPay Guard</strong>
          <span>Local policy proof for agent payment intents</span>
        </div>
        <div className="topbar-actions" aria-label="Execution boundary">
          <span className="topbar-chip">Mock rails</span>
          <span className="topbar-chip">No funds move</span>
          <span className="topbar-chip">JSONL audit</span>
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Preflight control layer</p>
          <h1>CitePay request, checked before settlement.</h1>
          <p className="hero-text">Turn a paid-source request into a proposed USDC payment intent, run AgentPay Guard preflight, and inspect an explainable decision with append-only evidence.</p>
          <div className="hero-actions">
            <button className="hero-cta-primary" onClick={runPrimaryDemo} type="button">
              {citePayIsSubmitting ? "Running CitePay..." : "Run CitePay demo"}
            </button>
          </div>
          <div className="hero-kpis" aria-label="Proof context">
            <div>
              <span>Input</span>
              <strong>Payment intent</strong>
            </div>
            <div>
              <span>Decision</span>
              <strong>ALLOW / REVIEW / BLOCK</strong>
            </div>
            <div>
              <span>Evidence</span>
              <strong>Audit ID + matched rules</strong>
            </div>
          </div>
        </div>

        <aside className="trust-card">
          <p className="eyebrow muted">Reviewer boundary</p>
          <h2>Control first. Execution later.</h2>
          <ul className="boundary-list">
            <li>No payment execution</li>
            <li>No wallet signing</li>
            <li>No private keys</li>
          </ul>
          <p className="boundary-footnote">This demo proves policy gating, deterministic decisions, and auditable evidence before money moves.</p>
        </aside>
      </section>

      <details className="architecture-strip" aria-label="Architecture flow">
        <summary>How it fits in the stack</summary>
        <div className="architecture-strip-grid">
          {architectureStages.map((stage) => (
            <span key={stage}>{stage}</span>
          ))}
        </div>
      </details>

      <section className="summary-strip-compact" aria-label="Live summary">
        <div className="summary-pill">
          <span>Proposed</span>
          <strong>{demoSummary.proposedSpend} USDC</strong>
        </div>
        <div className="summary-pill positive">
          <span>Allowed</span>
          <strong>{demoSummary.allowedSpend} USDC</strong>
        </div>
        <div className="summary-pill warning">
          <span>Review</span>
          <strong>{demoSummary.reviewCount}</strong>
        </div>
        <div className="summary-pill danger">
          <span>Blocked</span>
          <strong>{demoSummary.blockedCount}</strong>
        </div>
      </section>

      <section className="story-section" id="main-demo">
        <div className="section-heading narrative-heading">
          <div>
            <p className="eyebrow">Main demo narrative</p>
            <h2>Paid source to proposed payment intent</h2>
            <p className="section-subtitle">CitePay is the illustrative entry story. AgentPay Guard validates each proposed USDC intent before any future settlement adapter.</p>
          </div>
          <div className="micro-proof">
            <span className="mono-chip">{demoSummary.selectedCount} selected</span>
            <span className="mono-chip">{demoSummary.approvedCount} approved</span>
          </div>
        </div>

        <div className="quick-case-bar" aria-label="Quick policy cases">
          <div>
            <strong>Quick cases</strong>
            <span>Reuse existing intents for a compact policy proof.</span>
          </div>
          <div className="quick-case-actions">
            {quickCases.map((quickCase) => (
              <button
                className={`quick-case ${quickCase.id} ${activeQuickCaseId === quickCase.id ? "is-active" : ""}`}
                disabled={isSubmitting || citePayIsSubmitting}
                key={quickCase.id}
                onClick={() => void runQuickCase(quickCase)}
                type="button"
              >
                <strong>{quickCase.label}</strong>
                <span>{quickCase.description}</span>
              </button>
            ))}
          </div>
        </div>

        <article className="proposed-intent-panel" aria-label="Proposed payment intent">
          <div className="proposed-intent-head">
            <div>
              <p className="eyebrow">Policy input</p>
              <h3>Proposed payment intent</h3>
              <p className="section-subtitle">The request below is proposal context only. No wallet signing or transaction submission occurs.</p>
            </div>
            <span className="mono-chip">USDC / local preflight</span>
          </div>
          {proposedIntent ? <p className="proposed-intent-copy">{proposedIntent.intent}</p> : null}
          <dl className="proposed-intent-grid">
            {proposedIntentRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={label === "Agent ID" || label === "Recipient" || label === "Idempotency key" || label === "Payment rail" ? "mono-text" : ""}>{value}</dd>
              </div>
            ))}
          </dl>
        </article>

        <div className="story-grid">
          <article className="panel stage-panel">
            <div className="stage-heading">
              <span className="stage-index">01</span>
              <div>
                <p className="stage-label">Agent request</p>
                <h3>What the agent is trying to buy</h3>
              </div>
            </div>

            <div className="preset-strip">
              <div>
                <strong>{citePayDemoPreset.label}</strong>
                <span>{citePayDemoPreset.budget} USDC budget • local demo preset</span>
              </div>
              <button onClick={loadCitePayDemoPreset} type="button">
                Load preset
              </button>
            </div>

            <div className="form-grid compact-form">
              <label className="wide">
                <span>User question</span>
                <input value={citePayQuery} onChange={(event) => setCitePayQuery(event.target.value)} />
              </label>
              <label>
                <span>Budget cap</span>
                <input value={citePayBudget} onChange={(event) => setCitePayBudget(event.target.value)} />
              </label>
              <label>
                <span>Agent ID</span>
                <input readOnly value={citePayDemoPreset.agentId} />
              </label>
            </div>

            <button className="evaluate demo-cta" disabled={citePayIsSubmitting} onClick={runCitePayFlow} type="button">
              {citePayIsSubmitting ? "Running demo..." : "Run demo"}
            </button>
            {citePayError ? <p className="error">{citePayError}</p> : null}
          </article>

          <article className="panel stage-panel">
            <div className="stage-heading">
              <span className="stage-index">02</span>
              <div>
                <p className="stage-label">Selected paid sources</p>
                <h3>Which candidates make it into the spend set</h3>
              </div>
            </div>

            <div className="totals totals-compact">
              <span>Proposed: {demoSummary.proposedSpend} USDC</span>
              <span>Allowed: {demoSummary.allowedSpend} USDC</span>
            </div>

            {citePaySelection?.selected.length ? (
              <div className="source-list selected-sources">
                {citePaySelection.selected.map((selected) => {
                  const evaluation = citePayEvaluations.find((item) => item.source.id === selected.source.id);
                  return (
                    <article className="source-card candidate-card" key={selected.source.id}>
                      <div className="source-topline">
                        <strong>{selected.source.title}</strong>
                        <span className="mono-chip">{selected.source.price} {selected.source.currency}</span>
                      </div>
                      <p>{selected.paymentIntent.intent}</p>
                      <dl className="meta-grid">
                        <div>
                          <dt>Creator</dt>
                          <dd>{selected.source.creatorName}</dd>
                        </div>
                        <div>
                          <dt>Recipient</dt>
                          <dd className="mono-text">{selected.source.recipient}</dd>
                        </div>
                        <div>
                          <dt>Rail</dt>
                          <dd className="mono-text">{selected.source.paymentRail}</dd>
                        </div>
                        <div>
                          <dt>Status</dt>
                          <dd>{evaluation?.result.decision ?? "PENDING"}</dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <strong>No selected sources yet.</strong>
                <p>Run the preset to show how the agent picks candidate sources before any spend is evaluated.</p>
                <div className="catalog-preview" aria-label="Mock source catalog preview">
                  {citePayMockSources.slice(0, 3).map((source) => (
                    <div key={source.id}>
                      <span>{source.title}</span>
                      <strong>{source.price} {source.currency}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <details className="collapse-block">
              <summary>
                <span>Skipped sources</span>
                <span className="muted-copy">Optional details</span>
              </summary>
              <div className="collapse-content">
                {citePaySelection?.skipped.length ? (
                  <ul className="skipped-list">
                    {citePaySelection.skipped.map((skipped) => (
                      <li key={skipped.source.id}>
                        <strong>{skipped.source.title}</strong>
                        <span>{skipped.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-copy">No skipped sources yet.</p>
                )}
              </div>
            </details>
          </article>

          <article className="panel stage-panel decision-stage">
            <div className="stage-heading">
              <span className="stage-index">03</span>
              <div>
                <p className="stage-label">Guard decisions</p>
                <h3>What the control layer allows, reviews, or blocks</h3>
              </div>
            </div>

            {citePayEvaluations.length ? (
              <div className="decision-list">
                {citePayEvaluations.map((evaluation) => (
                  <article
                    className={`decision-card ${evaluation.result.decision.toLowerCase()} ${selectedReceiptAuditId === evaluation.result.auditId ? "is-selected" : ""}`}
                    key={evaluation.source.id}
                  >
                    <div className="decision-card-header">
                      <strong>{evaluation.source.title}</strong>
                      <span className={`status-chip ${evaluation.result.decision.toLowerCase()}`}>{evaluation.result.decision}</span>
                    </div>
                    <p>{evaluation.result.reason}</p>
                    <dl className="meta-grid">
                      <div>
                        <dt>Risk</dt>
                        <dd>{evaluation.result.riskScore}/100</dd>
                      </div>
                      <div>
                        <dt>Audit ID</dt>
                        <dd className="mono-text">{evaluation.result.auditId ?? "not written"}</dd>
                      </div>
                      <div>
                        <dt>Policy</dt>
                        <dd className="mono-text">{evaluation.result.policyId}</dd>
                      </div>
                      <div>
                        <dt>Matched rules</dt>
                        <dd className="rule-list-inline">{evaluation.result.matchedRules.join(", ")}</dd>
                      </div>
                      {renderReasonCodes(evaluation.result.reasonCodes)}
                    </dl>
                    <div className="decision-card-actions">
                      <button
                        className={selectedReceiptAuditId === evaluation.result.auditId ? "secondary-action is-active" : "secondary-action"}
                        disabled={!evaluation.result.auditId}
                        onClick={() => selectReceipt(evaluation.result.auditId)}
                        type="button"
                      >
                        View receipt
                      </button>
                    </div>
                    {renderRailPreview(evaluation.result.railPreview)}
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state emphasis">
                <strong>No decisions yet.</strong>
                <p>After the flow runs, each selected source gets an explicit decision, risk score, policy match, and audit ID.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="evidence-section" id="evidence">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Trust + evidence</p>
            <h2>AgentPay Receipt and decision proof</h2>
          </div>
          <button onClick={refreshAuditLog} type="button">
            Refresh proof
          </button>
        </div>

        <article className={`proof-card stacked ${primaryOutcome.decision.toLowerCase()}`}>
          <div className="proof-card-head">
            <span className="summary-label">Latest decision</span>
            <span className={`status-chip large ${primaryOutcome.decision.toLowerCase()}`}>
              {primaryOutcome.decision}
            </span>
          </div>
          <p className="proof-reason">{primaryOutcome.reason}</p>
          <dl className="proof-meta">
            <div>
              <dt>Risk score</dt>
              <dd>{primaryOutcome.riskScore === null ? "pending" : `${primaryOutcome.riskScore}/100`}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{proposedIntent ? `${proposedIntent.amount} ${proposedIntent.currency}` : "pending"}</dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd className="mono-text">{proposedIntent?.recipient ?? "pending"}</dd>
            </div>
            <div>
              <dt>Scenario</dt>
              <dd className="mono-text">{proposedIntent?.scenario ?? "pending"}</dd>
            </div>
            <div>
              <dt>Audit trace</dt>
              <dd className="mono-text">{primaryOutcome.auditId}</dd>
            </div>
            <div className="wide-proof-row">
              <dt>Matched rules</dt>
              <dd className="rule-list-inline">
                {latestRules.length ? latestRules.join(", ") : "Run the demo to populate proof."}
              </dd>
            </div>
            <div className="wide-proof-row">
              <dt>Reason codes</dt>
              <dd className="rule-list-inline">
                {latestReasonCodes.length ? latestReasonCodes.join(", ") : "Run the demo to populate evidence codes."}
              </dd>
            </div>
          </dl>
        </article>

        <article className="panel receipt-panel" aria-label="AgentPay Receipt">
          <div className="section-heading receipt-heading">
            <div>
              <p className="eyebrow">Preview artifact</p>
              <h2>AgentPay Receipt</h2>
              <p className="section-subtitle">Focused proof for one evaluated spend intent. Use the decision cards above or the validator to populate it.</p>
            </div>
            <button disabled={!agentPayReceipt} onClick={copyReceiptJson} type="button">
              {copyState === "copied"
                ? "Receipt copied"
                : copyState === "unavailable"
                  ? "Clipboard unavailable"
                  : copyState === "error"
                    ? "Copy failed"
                    : "Copy receipt JSON"}
            </button>
          </div>

          {agentPayReceipt ? (
            <div className="receipt-layout">
              <article className={`receipt-card ${agentPayReceipt.decision.toLowerCase()}`}>
                <div className="receipt-card-head">
                  <div>
                    <span className="summary-label">Selected evaluated intent</span>
                    <h3>AgentPay Receipt</h3>
                  </div>
                  <span className={`status-chip ${agentPayReceipt.decision.toLowerCase()}`}>{agentPayReceipt.decision}</span>
                </div>
                <dl className="receipt-grid">
                  <div>
                    <dt>Agent</dt>
                    <dd className="mono-text">{agentPayReceipt.agentIdentity ?? "not provided"}</dd>
                  </div>
                  <div>
                    <dt>Request</dt>
                    <dd className="mono-text">{agentPayReceipt.requestIdentity ?? "not provided"}</dd>
                  </div>
                  <div>
                    <dt>Intent ID</dt>
                    <dd className="mono-text">{agentPayReceipt.intentId}</dd>
                  </div>
                  <div>
                    <dt>Recipient</dt>
                    <dd>{agentPayReceipt.recipientLabel}</dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd>{agentPayReceipt.amountUSDC} USDC</dd>
                  </div>
                  <div>
                    <dt>Purpose</dt>
                    <dd className="mono-text">{agentPayReceipt.purpose}</dd>
                  </div>
                  <div>
                    <dt>Execution mode</dt>
                    <dd className="mono-text">{agentPayReceipt.executionMode}</dd>
                  </div>
                  <div>
                    <dt>Funds moved</dt>
                    <dd className="mono-text">{String(agentPayReceipt.fundsMoved)}</dd>
                  </div>
                  <div>
                    <dt>Audit ID</dt>
                    <dd className="mono-text">{agentPayReceipt.auditId}</dd>
                  </div>
                  <div>
                    <dt>Timestamp</dt>
                    <dd>{new Date(agentPayReceipt.timestamp).toLocaleString()}</dd>
                  </div>
                  <div className="wide-proof-row">
                    <dt>Reason codes</dt>
                    <dd className="rule-list-inline">
                      {agentPayReceipt.reasonCodes.length ? agentPayReceipt.reasonCodes.join(", ") : "none"}
                    </dd>
                  </div>
                </dl>
                <div className="wide-proof-row">
                  <dt>Matched rules</dt>
                  <dd className="rule-list-inline">{selectedAuditRecord?.matchedRules.length ? selectedAuditRecord.matchedRules.join(", ") : "none"}</dd>
                </div>
                {renderRailPreview(agentPayReceipt.railPreview, agentPayReceipt.programmablePaymentContext)}
                <p className="receipt-note">{agentPayReceipt.safetyNote}</p>
              </article>

              <div className="audit-json-block">
                <h4>Structured JSON preview</h4>
                <pre>{JSON.stringify(agentPayReceipt, null, 2)}</pre>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <strong>No receipt selected yet.</strong>
              <p>Run the demo or test a validator intent to show a receipt with audit-backed decision proof.</p>
            </div>
          )}
        </article>

        <details className="panel audit-panel collapse-block">
          <summary className="collapse-summary-strong">
            <span>Full audit log</span>
            <span className="muted-copy">Expand for machine-readable history</span>
          </summary>
          <div className="collapse-content">
            <div className="section-heading audit-heading">
              <div>
                <h3>Recent audit log</h3>
                <p className="section-subtitle">Machine-readable history of recent decisions and spend intents.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Decision</th>
                    <th>Agent</th>
                    <th>Amount</th>
                    <th>Recipient</th>
                    <th>Audit ID</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.auditId}>
                      <td>{new Date(record.timestamp).toLocaleString()}</td>
                      <td>
                        <span className={`status-chip ${record.decision.toLowerCase()}`}>{record.decision}</span>
                      </td>
                      <td>{record.agentId}</td>
                      <td>
                        {record.amount} {record.currency}
                      </td>
                      <td className="mono-text">{record.recipient}</td>
                      <td className="mono-text">{record.auditId}</td>
                    </tr>
                  ))}
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No audit records yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {auditPreview ? (
              <div className="audit-json-block">
                <h4>Structured audit preview</h4>
                <pre>{JSON.stringify(auditPreview, null, 2)}</pre>
                {renderProgrammableEvidence(auditPreview.railPreview, auditPreview.programmablePaymentContext)}
              </div>
            ) : null}
          </div>
        </details>

        <section className="settlement-boundary" aria-label="Future settlement boundary">
          <div className="settlement-boundary-head">
            <div>
              <p className="eyebrow">After evidence</p>
              <h3>Future settlement boundary</h3>
            </div>
            <span>{settlementBoundary.label}</span>
          </div>
          <div className="settlement-boundary-flow">
            {settlementBoundary.stages.map((stage, index) => (
              <div className="settlement-boundary-stage" key={stage}>
                <strong>{stage}</strong>
                {index < settlementBoundary.stages.length - 1 ? <span aria-hidden="true">-&gt;</span> : null}
              </div>
            ))}
          </div>
        </section>
      </section>

      <details className="validator-section collapse-block">
        <summary className="collapse-summary-strong">
          <span>Policy test cases</span>
          <span className="muted-copy">Expand validator mode</span>
        </summary>
        <div className="collapse-content">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Validator mode</p>
              <h2>Policy test cases</h2>
              <p className="section-subtitle">Editable payment intents for deterministic ALLOW / REVIEW / BLOCK proofs.</p>
            </div>
          </div>

          <div className="validator-grid">
            <div className="panel">
              <h3>Scenario</h3>
              <div className="scenario-grid">
                {scenarios.map((scenario, index) => (
                  <button
                    className={index === selectedIndex ? "scenario active" : "scenario"}
                    key={scenario.fileName}
                    onClick={() => setSelectedIndex(index)}
                    type="button"
                  >
                    <strong>{scenario.label}</strong>
                    <span>{scenario.expectedDecision}</span>
                  </button>
                ))}
              </div>

              <div className="form-grid">
                {fieldLabels.map(([field, label]) => (
                  <label className={field === "intent" ? "wide" : ""} key={field}>
                    <span>{label}</span>
                    <input value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />
                  </label>
                ))}
              </div>

              <button className="evaluate" disabled={isSubmitting} onClick={evaluate} type="button">
                {isSubmitting ? "Evaluating..." : "Test decision"}
              </button>
              {error ? <p className="error">{error}</p> : null}
            </div>

            <div className={`decision ${decisionClass}`}>
              <h3>Decision</h3>
              {result ? (
                <>
                  <div className="decision-line">
                    <strong>{result.decision}</strong>
                    <span>Risk {result.riskScore}/100</span>
                  </div>
                  <p>{result.reason}</p>
                  <dl className="meta-grid">
                    <div>
                      <dt>Audit ID</dt>
                      <dd className="mono-text">{result.auditId ?? "not written"}</dd>
                    </div>
                    <div>
                      <dt>Policy</dt>
                      <dd className="mono-text">{result.policyId}</dd>
                    </div>
                  </dl>
                  <h4>Matched rules</h4>
                  <ul className="rule-list">
                    {result.matchedRules.map((rule) => (
                      <li className="mono-text" key={rule}>
                        {rule}
                      </li>
                    ))}
                  </ul>
                  <h4>Reason codes</h4>
                  <ul className="rule-list">
                    {(result.reasonCodes ?? []).map((code) => (
                      <li className="mono-text" key={code}>
                        {code}
                      </li>
                    ))}
                  </ul>
                  {renderRailPreview(result.railPreview)}
                </>
              ) : (
                <div className="empty-state emphasis">
                  <strong>No validator output yet.</strong>
                  <p>Select a test case and evaluate it to show a deterministic policy result.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </details>
    </main>
  );
}
