import { agentJsonSchema } from "@agents/spec";
export const dynamic = "force-static";
export function GET() {
  return Response.json(agentJsonSchema);
}
