import { z } from "zod";
import {
  advise,
  describeFromAnswers,
  describeInputSchema,
  describeRequest,
  jevInputSchema,
  propose,
  recommendFromAnswers,
  recommendRequest,
  systemOneResponseSchema,
  TYPESAFE_URL,
  typesafeModel,
  verifyCoverage,
  verifyFromAnswers,
  verifyRequest,
  type Answers,
} from "@agents/jev";
import { agentPrompt, agentSchema } from "@agents/spec";
import { apiError, assertSameOrigin, readBody } from "../../../lib/server/builds";

let active = 0,
  used = 0,
  windowStart = 0;
const apiKey = () => process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY;
/**
 * One Jev (TypeSafe System One) request, or undefined when Jev isn't configured or the
 * per-process budget is spent. Rules stay available either way.
 */
function jev() {
  if (Date.now() - windowStart > 60000) {
    windowStart = Date.now();
    used = 0;
  }
  if (!apiKey() || used >= 20 || active >= 3) return undefined;
  return async (body: { state: unknown; questions: unknown }, signal: AbortSignal): Promise<Answers> => {
    used++;
    active++;
    try {
      const response = await fetch(TYPESAFE_URL, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
        body: JSON.stringify({ model: typesafeModel(process.env.JEV_MODEL), ...body }),
      });
      if (!response.ok) throw new Error(`Jev unavailable (HTTP ${response.status})`);
      return systemOneResponseSchema.parse(await response.json()).answers;
    } finally {
      active--;
    }
  };
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readBody(request);
    const call = jev();
    const headers = { "Cache-Control": "no-store" };
    // { verify: spec } checks a created agent against its confirmed requirements.
    if (typeof body === "object" && body !== null && "verify" in body) {
      const { verify: spec } = z.object({ verify: agentSchema }).strict().parse(body);
      const requirements = spec.requirements || [];
      return Response.json(
        await verifyCoverage(
          requirements,
          `Description: ${spec.description}\n\n${agentPrompt(spec)}`,
          call && (async (payload, signal) => verifyFromAnswers(requirements, await call(verifyRequest(requirements, payload.agent), signal))),
        ),
        { headers },
      );
    }
    // { description } asks for a whole draft; anything else is the skills recommendation.
    if (typeof body === "object" && body !== null && "description" in body) {
      const { description } = describeInputSchema.parse(body);
      return Response.json(
        await propose(description, call && (async (text, signal) => describeFromAnswers(text, await call(describeRequest(text), signal)))),
        { headers },
      );
    }
    const input = jevInputSchema.parse(body);
    return Response.json(
      await advise(input, call && (async (data, signal) => recommendFromAnswers(await call(recommendRequest(data), signal)))),
      { headers },
    );
  } catch (error) {
    return apiError(error);
  }
}
