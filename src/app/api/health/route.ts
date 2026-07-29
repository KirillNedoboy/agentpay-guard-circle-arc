export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({
    status: "ok",
    service: "agentpay-guard",
    execution: "simulation-only"
  });
}
