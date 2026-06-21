"use client";

import { useEffect, useMemo, useState } from "react";
import {
  citePayDemoPreset,
  citePayMockSources,
  selectCitePaySources
} from "@/domain/citepay/source-selection";
import type { CitePaySelectedSource, CitePaySelectionResult } from "@/domain/citepay/types";
import type { AuditRecord } from "@/domain/audit/types";
import type { PaymentIntent } from "@/domain/payment-intent/types";
import { buildDemoSummary } from "./demo-metrics";

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
  policyId: string;
  auditId: string | null;
  createdAt: string;
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

const architectureStages = ["AI Agent", "AgentPay Guard", "x402 / Circle Gateway", "Paid API / Service"];

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

  const decisionClass = useMemo(() => result?.decision.toLowerCase() ?? "empty", [result]);
  const demoSummary = useMemo(() => buildDemoSummary(citePaySelection, citePayEvaluations), [citePaySelection, citePayEvaluations]);
  const latestAuditRecord = records[0] ?? null;
  const latestRules = useMemo(() => {
    const unique = new Set<string>();
    for (const evaluation of citePayEvaluations) {
      for (const rule of evaluation.result.matchedRules) {
        unique.add(rule);
      }
    }
    if (result) {
      for (const rule of result.matchedRules) {
        unique.add(rule);
      }
    }
    return Array.from(unique);
  }, [citePayEvaluations, result]);

  return (
    <main className="shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">AI payment safety layer</p>
          <h1>AgentPay Guard</h1>
          <p className="hero-text">
            Preflight policy and audit control between an AI agent and any paid API, x402 rail, Circle Gateway, or Arc-style spend flow.
          </p>
          <div className="hero-notes">
            <span className="mono-chip">Agent request → paid sources → guard decisions → audit evidence</span>
            <span className="hero-note">Built for fast reviewer understanding and phone-recorded demos.</span>
          </div>
        </div>

        <aside className="trust-card">
          <p className="eyebrow muted">Boundary</p>
          <h2>Control first, execution later</h2>
          <ul className="boundary-list">
            <li>No payment execution</li>
            <li>No wallet signing</li>
            <li>No private keys</li>
          </ul>
          <p className="boundary-footnote">This demo proves policy gating, deterministic decisions, and auditable evidence before money moves.</p>
        </aside>
      </section>

      <section className="architecture-strip" aria-label="Architecture flow">
        {architectureStages.map((stage) => (
          <span key={stage}>{stage}</span>
        ))}
      </section>

      <section className="summary-strip" aria-label="Live summary">
        <article className="summary-card accent">
          <span className="summary-label">Proposed spend</span>
          <strong>{demoSummary.proposedSpend} USDC</strong>
        </article>
        <article className="summary-card positive">
          <span className="summary-label">Allowed spend</span>
          <strong>{demoSummary.allowedSpend} USDC</strong>
        </article>
        <article className="summary-card warning">
          <span className="summary-label">Needs review</span>
          <strong>{demoSummary.reviewCount}</strong>
        </article>
        <article className="summary-card danger">
          <span className="summary-label">Blocked</span>
          <strong>{demoSummary.blockedCount}</strong>
        </article>
      </section>

      <section className="story-section">
        <div className="section-heading narrative-heading">
          <div>
            <p className="eyebrow">Main demo narrative</p>
            <h2>CitePay flow with Guard in the loop</h2>
            <p className="section-subtitle">Run one query, inspect the paid-source candidates, and show how every spend request is allowed, reviewed, or blocked with audit evidence.</p>
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

            <button className="evaluate" disabled={citePayIsSubmitting} onClick={runCitePayFlow} type="button">
              {citePayIsSubmitting ? "Evaluating sources..." : "Run paid-source selection + Guard"}
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

            <div className="subsection-block">
              <div className="subsection-heading">
                <h4>Skipped sources</h4>
                <span className="muted-copy">Lower-priority evidence</span>
              </div>
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
                    </dl>
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

      <section className="evidence-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Trust + evidence</p>
            <h2>Deterministic decisions with visible audit proof</h2>
          </div>
          <button onClick={refreshAuditLog} type="button">
            Refresh audit log
          </button>
        </div>

        <div className="evidence-grid">
          <article className="panel evidence-card">
            <h3>What this proves</h3>
            <p className="section-subtitle">
              Guard does not just return a verdict. It shows the rule path, machine-readable identifiers, and recent decision history so a reviewer can verify why the spend was gated.
            </p>
            <dl className="meta-grid">
              <div>
                <dt>Latest audit</dt>
                <dd className="mono-text">{latestAuditRecord?.auditId ?? "none yet"}</dd>
              </div>
              <div>
                <dt>Latest decision</dt>
                <dd>{latestAuditRecord?.decision ?? "not run"}</dd>
              </div>
              <div>
                <dt>Recent matched rules</dt>
                <dd className="rule-list-inline">{latestRules.length ? latestRules.join(", ") : "Run the demo or validator to populate evidence."}</dd>
              </div>
              <div>
                <dt>Recent records</dt>
                <dd>{records.length}</dd>
              </div>
            </dl>
          </article>

          <article className="panel evidence-card validator-callout">
            <h3>Secondary validator mode</h3>
            <p className="section-subtitle">
              The original ALLOW / REVIEW / BLOCK scenarios stay here as deterministic policy test cases. They still prove the engine works, but no longer steal attention from the main product demo.
            </p>
            <span className="mono-chip">Policy test cases below</span>
          </article>
        </div>

        <div className="panel audit-panel">
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
        </div>
      </section>

      <section className="validator-section">
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
              {isSubmitting ? "Evaluating..." : "Evaluate payment intent"}
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
              </>
            ) : (
              <div className="empty-state emphasis">
                <strong>No validator output yet.</strong>
                <p>Select a test case and evaluate it to show a deterministic policy result.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
