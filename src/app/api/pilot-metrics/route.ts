import { readAllAuditRecords } from "@/domain/audit/audit-log";
import { readEvaluationObservations } from "@/domain/observability/evaluation-observation-log";
import { buildPilotMetrics } from "@/domain/observability/pilot-metrics";
import { auditLogPath, observationLogPath } from "@/lib/paths";

export async function GET(): Promise<Response> {
  const metrics = buildPilotMetrics(readAllAuditRecords(auditLogPath()), readEvaluationObservations(observationLogPath()));
  return Response.json({ metrics });
}
