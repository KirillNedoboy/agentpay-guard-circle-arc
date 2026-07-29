import { expect, test } from "vitest";
import { GET } from "@/app/api/health/route";

test("health endpoint reports the local demo as ready without exposing secrets", async () => {
  const response = await GET();
  const body = (await response.json()) as Record<string, unknown>;

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ status: "ok", service: "agentpay-guard", execution: "simulation-only" });
  expect(JSON.stringify(body)).not.toMatch(/privateKey|seedPhrase|token|secret/i);
});
