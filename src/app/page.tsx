import { readFileSync } from "node:fs";
import { join } from "node:path";
import DemoClient, { type Scenario } from "./demo-client";

const scenarioFiles = [
  ["Trusted x402 API purchase", "scenario-allow-api.json"],
  ["Premium dataset review", "scenario-review-machine.json"],
  ["Untrusted source block", "scenario-block-risky.json"],
  ["CCTP Fast Transfer review", "scenario-review-cctp-fast-transfer.json"],
  ["CCTP standard route allow", "scenario-allow-cctp-standard.json"],
  ["CCTP unsupported route block", "scenario-block-cctp-route.json"],
  ["ERC-20 approval review", "scenario-review-erc20-approval.json"]
] as const;

function loadScenarios(): Scenario[] {
  return scenarioFiles.map(([label, fileName]) => {
    const raw = readFileSync(join(process.cwd(), "examples", fileName), "utf8");
    const parsed = JSON.parse(raw) as Scenario["intent"] & { expectedDecision: string };
    const { expectedDecision, ...intent } = parsed;
    return {
      label,
      fileName,
      expectedDecision,
      intent
    };
  });
}

export default function Page() {
  return <DemoClient scenarios={loadScenarios()} />;
}
