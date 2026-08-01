"use client";

import { useEffect, useMemo, useState } from "react";
import {
  citePayDemoPreset,
  citePayMockSources,
  selectCitePaySources
} from "@/domain/citepay/source-selection";
import type { CitePaySelectedSource, CitePaySelectionResult } from "@/domain/citepay/types";
import type { AuditRecord } from "@/domain/audit/types";
import type { ArcTestnetSimulation, CircleRailPreview, PaymentIntent } from "@/domain/payment-intent/types";
import { x402JudgePreset } from "@/domain/payment-intent/judge-preset";
import type { SpendControls } from "@/domain/policy/spend-controls";
import {
  buildAuditPreview,
  buildDemoSummary,
  buildRailPreviewRows,
  buildReasonCodeRows,
  buildSimulationRows,
  buildSpendControlRows
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
  spendControls?: SpendControls;
  arcTestnetSimulation?: ArcTestnetSimulation;
};

type FieldName = keyof PaymentIntent;

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

const architectureStages = ["AI Agent", "AgentPay Guard", "AgentPay Receipt", "Future x402 / Circle Gateway / Arc adapter"];

export default function DemoClient({ scenarios }: { scenarios: Scenario[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedScenario = scenarios[selectedIndex] ?? scenarios[0];
  const [form, setForm] = useState<PaymentIntent>(selectedScenario.intent);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [citePayQuery, setCitePayQuery] = useState<string>(citePayDemoPreset.query);
  const [citePayBudget, setCitePayBudget] = useState<string>(citePayDemoPreset.budget);
  const [citePaySelection, setCitePaySelection] = useState<CitePaySelectionResult | null>(null);
  const [citePayEvaluations, setCitePayEvaluations] = useState<CitePayEvaluatedSource[]>([]);
  const [citePayIsSubmitting, setCitePayIsSubmitting] = useState(false);
  const [citePayError, setCitePayError] = useState<string | null>(null);
  const [judgeResult, setJudgeResult] = useState<EvaluationResult | null>(null);
  const [judgeIsSubmitting, setJudgeIsSubmitting] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);

  useEffect(() => {
    setForm(selectedScenario.intent);
    setResult(null);
    setError(null);
  }, [selectedScenario]);

  async function refreshAuditLog() {
    const response = await fetch("/api/audit-log", { cache: "no-store" });
    const data = (await response.json()) as { records: AuditRecord[] };
    setRecords(data.records);
  }

  useEffect(() => {
    void refreshAuditLog();
  }, []);

  async function evaluate() {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/payment-intents/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = (await response.json()) as EvaluationResult;
      setResult(data);
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

  function loadCitePayDemoPreset() {
    setCitePayQuery(citePayDemoPreset.query);
    setCitePayBudget(citePayDemoPreset.budget);
    setCitePaySelection(null);
    setCitePayEvaluations([]);
    setCitePayError(null);
  }

  async function runCitePayFlow() {
    setCitePayIsSubmitting(true);
    setCitePayError(null);
    setCitePayEvaluations([]);

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
      await refreshAuditLog();
    } catch {
      setCitePayError("CitePay evaluation failed locally.");
    } finally {
      setCitePayIsSubmitting(false);
    }
  }

  async function runJudgePreset() {
    setJudgeIsSubmitting(true);
    setJudgeError(null);
    try {
      const response = await fetch("/api/payment-intents/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(x402JudgePreset.intent)
      });
      const data = (await response.json()) as EvaluationResult;
      setJudgeResult(data);
      if (!response.ok) {
        setJudgeError(data.reason);
      }
      await refreshAuditLog();
    } catch {
      setJudgeError("x402 policy proof could not be evaluated locally.");
    } finally {
      setJudgeIsSubmitting(false);
    }
  }

  const decisionClass = useMemo(() => result?.decision.toLowerCase() ?? "empty", [result]);
  const demoSummary = useMemo(() => buildDemoSummary(citePaySelection, citePayEvaluations), [citePaySelection, citePayEvaluations]);
  const auditPreview = useMemo(() => buildAuditPreview(records[0]), [records]);
  const approvedSimulation = useMemo(
    () => citePayEvaluations.find((item) => item.result.decision === "ALLOW")?.result.arcTestnetSimulation,
    [citePayEvaluations]
  );
  const primaryOutcome = useMemo(() => {
    if (judgeResult) {
      return {
        decision: judgeResult.decision,
        reason: judgeResult.reason,
        auditId: judgeResult.auditId ?? "pending"
      };
    }

    const rankedEvaluation =
      citePayEvaluations.find((item) => item.result.decision === "BLOCK") ??
      citePayEvaluations.find((item) => item.result.decision === "REVIEW") ??
      citePayEvaluations.find((item) => item.result.decision === "ALLOW") ??
      null;

    if (!rankedEvaluation) {
      return {
        decision: "READY",
        reason: "Run the x402 policy proof to show the decision, policy envelope, and audit receipt.",
        auditId: "pending"
      };
    }

    return {
      decision: rankedEvaluation.result.decision,
      reason: rankedEvaluation.result.reason,
      auditId: rankedEvaluation.result.auditId ?? "pending"
    };
  }, [citePayEvaluations, judgeResult]);

  function scrollToId(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function runPrimaryDemo() {
    scrollToId("judge-proof");
    void runJudgePreset();
  }

  function renderRailPreview(preview: CircleRailPreview | undefined) {
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

  function renderArcTestnetSimulation(simulation: ArcTestnetSimulation | undefined) {
    const rows = buildSimulationRows(simulation);
    if (!rows.length) {
      return (
        <div className="empty-state emphasis">
          <strong>Awaiting an approved intent.</strong>
          <p>Only an ALLOW decision on the Arc Testnet preview route may enter the simulation boundary.</p>
        </div>
      );
    }

    return (
      <div className={`simulation-card ${simulation?.status ?? "not_eligible"}`} aria-label="Arc Testnet simulation evidence">
        <div className="simulation-card-head">
          <strong>Arc Testnet USDC simulation</strong>
          <span className="execution-chip not_broadcast">{simulation?.verificationStatus}</span>
        </div>
        <dl className="rail-preview-grid">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={label === "Network" || label === "Verification" ? "mono-text" : ""}>{value}</dd>
            </div>
          ))}
        </dl>
        <p>{simulation?.reason}</p>
        <p className="rail-preview-boundary">No funds moved. Settlement was not executed.</p>
      </div>
    );
  }

  function renderSpendControls(controls: SpendControls | undefined) {
    const rows = buildSpendControlRows(controls);
    if (!rows.length) {
      return (
        <div className="empty-state emphasis">
          <strong>Run the x402 policy proof.</strong>
          <p>The daily budget, per-request limit, and velocity evidence are attached to the receipt after evaluation.</p>
        </div>
      );
    }

    return (
      <dl className="policy-envelope-grid" aria-label="Deterministic policy envelope">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={label === "Velocity" ? "mono-text" : ""}>{value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <main className="shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Deterministic policy and evidence control plane</p>
          <h1>AgentPay Guard</h1>
          <p className="hero-text">Evaluate an x402-style USDC API micropayment before any future settlement adapter can execute.</p>
          <div className="hero-actions">
            <button className="hero-cta-primary" onClick={runPrimaryDemo} type="button">
              {judgeIsSubmitting ? "Evaluating policy..." : "Run x402 policy proof"}
            </button>
          </div>
          <div className="hero-notes">
            <span className="mono-chip">USDC API micropayment</span>
            <span className="mono-chip">Append-only receipt</span>
            <span className="mono-chip">Preview-only adapter</span>
          </div>
        </div>

        <aside className="trust-card">
          <p className="eyebrow muted">Boundary</p>
          <h2>Control first, execution later</h2>
          <ul className="boundary-list">
            <li>No payment execution</li>
            <li>No wallet signing</li>
            <li>No transaction broadcast</li>
          </ul>
          <p className="boundary-footnote">This demo proves policy gating, deterministic decisions, and auditable evidence before money moves.</p>
        </aside>
      </section>

      <details className="architecture-strip" aria-label="Architecture flow">
        <summary>How the guard fits before settlement</summary>
        <div className="architecture-strip-grid">
          {architectureStages.map((stage) => (
            <span key={stage}>{stage}</span>
          ))}
        </div>
      </details>

      <section className="judge-proof-section" id="judge-proof" aria-label="x402 policy proof">
        <div className="section-heading narrative-heading">
          <div>
            <p className="eyebrow">Judge path</p>
            <h2>One USDC intent. One explicit decision.</h2>
            <p className="section-subtitle">The preset checks a trusted x402-style API request against recipient, amount, daily budget, velocity, and deterministic policy before any adapter boundary.</p>
          </div>
          <span className="mono-chip">{x402JudgePreset.intent.amount} USDC</span>
        </div>

        <div className="judge-proof-grid">
          <article className={`proof-card ${primaryOutcome.decision.toLowerCase()}`} aria-label="Guard decision">
            <div className="proof-card-head">
              <span className="summary-label">Guard decision</span>
              <span className={`status-chip large ${primaryOutcome.decision.toLowerCase()}`}>
                {primaryOutcome.decision}
              </span>
            </div>
            <p className="proof-reason">{primaryOutcome.reason}</p>
            <dl className="proof-meta">
              <div>
                <dt>Audit trace</dt>
                <dd className="mono-text">{primaryOutcome.auditId}</dd>
              </div>
              <div>
                <dt>Matched rules</dt>
                <dd className="rule-list-inline">
                  {judgeResult?.matchedRules.length ? judgeResult.matchedRules.join(", ") : "Run the x402 policy proof to populate this receipt."}
                </dd>
              </div>
              <div>
                <dt>Reason codes</dt>
                <dd className="rule-list-inline">
                  {judgeResult?.reasonCodes?.length ? judgeResult.reasonCodes.join(", ") : "Run the x402 policy proof to populate this receipt."}
                </dd>
              </div>
            </dl>
          </article>

          <article className="panel policy-envelope-panel">
            <p className="stage-label">Deterministic policy envelope</p>
            <h3>Budget and velocity evidence</h3>
            {renderSpendControls(judgeResult?.spendControls)}
          </article>
        </div>

        <div className="settlement-handoff" aria-label="Future settlement handoff">
          <strong>AgentPay Receipt</strong>
          <span aria-hidden="true">&rarr;</span>
          <strong>Future settlement adapter</strong>
          <span aria-hidden="true">&rarr;</span>
          <strong>x402 / Circle Gateway / Arc</strong>
          <em>Preview only: no funds moved, signed, or broadcast.</em>
        </div>
        {judgeResult ? renderRailPreview(judgeResult.railPreview) : null}
        {judgeError ? <p className="error">{judgeError}</p> : null}
      </section>

      <details className="story-section citepay-secondary collapse-block" id="citepay-flow">
        <summary className="collapse-summary-strong">
          <span>Illustrative CitePay source-selection flow</span>
          <span className="muted-copy">Optional secondary demo</span>
        </summary>
        <div className="collapse-content">
          <div className="section-heading narrative-heading">
            <div>
              <p className="eyebrow">Illustrative source selection</p>
              <h2>CitePay flow with Guard in the loop</h2>
              <p className="section-subtitle">Run one query, inspect paid-source candidates, and show how each proposed spend is evaluated with audit evidence. This is a local illustration, not the primary product path.</p>
            </div>
            <div className="micro-proof">
              <span className="mono-chip">{demoSummary.selectedCount} selected</span>
              <span className="mono-chip">{demoSummary.approvedCount} approved</span>
            </div>
          </div>

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
                  <article className={`decision-card ${evaluation.result.decision.toLowerCase()}`} key={evaluation.source.id}>
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

          <article className="panel stage-panel simulation-stage">
            <div className="stage-heading">
              <span className="stage-index">04</span>
              <div>
                <p className="stage-label">Simulation boundary</p>
                <h3>Only the approved intent reaches Arc Testnet simulation</h3>
              </div>
            </div>
            {renderArcTestnetSimulation(approvedSimulation)}
          </article>
          </div>
        </div>
      </details>

      <section className="evidence-section" id="evidence">
        <div className="section-heading">
          <div>
            <p className="eyebrow">AgentPay Receipt</p>
            <h2>Audit evidence</h2>
            <p className="section-subtitle">Each evaluation is retained locally as append-only JSONL and replayed by idempotency key.</p>
          </div>
          <button onClick={refreshAuditLog} type="button">
            Refresh proof
          </button>
        </div>

        <details className="panel audit-panel collapse-block">
          <summary className="collapse-summary-strong">
            <span>Receipt and audit log</span>
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
              </div>
            ) : null}
          </div>
        </details>
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
