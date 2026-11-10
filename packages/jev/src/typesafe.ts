// Jev by TypeSafe (https://docs.typesafe.ai): a "System One" model that answers typed questions
// (Choice, Noul) about a state with calibrated probabilities. It does not write prose, so it makes
// Jev's decisions (category, skills, requirements, coverage) while rules write the text.
import { z } from "zod";
import { cadencePhrase, categories, coverageHints, requirementText, type Requirement } from "@agents/spec";
import { catalog } from "./catalog";
import { nameFromDescription } from "./describe";

export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
/** Model ids are lowercase; "Jev-1.14.0" is rejected by the API. */
export const typesafeModel = (value: string | undefined) => (value || "jev-latest").trim().toLowerCase();
type Question =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };
export type Questions = Record<string, Question>;
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }).passthrough(),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    probabilities: z.record(z.number().min(0).max(1)),
  }).passthrough(),
  z.object({ type: z.enum(["score", "box"]) }).passthrough(),
]);
export const systemOneResponseSchema = z.object({ model: z.string(), answers: z.record(answerSchema) }).passthrough();
export type Answers = z.infer<typeof systemOneResponseSchema>["answers"];
const noul = (answers: Answers, id: string) => {
  const answer = answers[id];
  return answer?.type === "noul" ? answer.noul : 0;
};
const choice = (answers: Answers, id: string) => {
  const answer = answers[id];
  return answer?.type === "choice" ? { value: answer.choice, p: answer.probabilities[answer.choice] ?? 0 } : undefined;
};
/** A skill is picked when Jev thinks it is more likely needed than not, with some margin. */
export const PICK_THRESHOLD = 0.75;
/** An assumed requirement needs a clear majority; the user still confirms every one. */
export const REQUIREMENT_THRESHOLD = 0.6;
export const COVERED_THRESHOLD = 0.5;

function requirementQuestions(): Questions {
  return {
    "req:delivery": {
      type: "choice",
      instructions: "Where should this agent deliver its result?",
      criteria: {
        conversation: "Back in the conversation or terminal where it was asked",
        email: "In an email",
      },
    },
    "req:recipient": {
      type: "choice",
      instructions: "If this agent sends email, who receives it?",
      criteria: {
        self: "The person who asked for the agent (they say me, my, or I)",
        others: "Other people, such as customers, a team or subscribers",
        none: "The agent sends no email",
      },
    },
    "req:trigger": {
      type: "choice",
      instructions: "Should this agent run on its own on a schedule, and how often?",
      criteria: {
        on_demand: "Only when someone asks it to",
        daily: "Every day",
        weekdays: "Every weekday",
        weekly: "Every week",
        monthly: "Every month",
      },
    },
    "req:research": { type: "noul", instructions: "Does this agent need to look up current information on the web?" },
  };
}
function requirementsFrom(answers: Answers) {
  const found: { type: Requirement["type"]; value: string; quote: string; origin: "assumed" }[] = [];
  const add = (type: Requirement["type"], value: string) => found.push({ type, value, quote: "", origin: "assumed" });
  const delivery = choice(answers, "req:delivery");
  if (delivery && delivery.p >= REQUIREMENT_THRESHOLD) add("delivery", delivery.value);
  const recipient = choice(answers, "req:recipient");
  if (delivery?.value === "email" && recipient && recipient.value !== "none" && recipient.p >= REQUIREMENT_THRESHOLD)
    add("recipient", recipient.value);
  const trigger = choice(answers, "req:trigger");
  if (trigger && trigger.value !== "on_demand" && trigger.p >= REQUIREMENT_THRESHOLD) add("trigger", trigger.value);
  if (noul(answers, "req:research") >= REQUIREMENT_THRESHOLD) add("research", "web");
  return found;
}
// Sending and reading mail are easy to confuse ("email me" is not mailbox access); ask precisely.
const toolWording: Partial<Record<string, string>> = {
  "read-email": "Does this agent need to read emails the user has received, such as their inbox or customer emails? Sending an email is not reading one.",
  "send-email": "Does this agent need to send an email itself? Drafting a reply for the user to send is not sending.",
};
function toolQuestions(): Questions {
  return Object.fromEntries(
    catalog.map((tool) => [
      `tool:${tool.id}`,
      {
        type: "noul" as const,
        instructions: toolWording[tool.id] || `Does this agent need this capability to do its job: ${tool.name}. ${tool.description}`,
      },
    ]),
  );
}
function picksFrom(answers: Answers) {
  return catalog.flatMap((tool) => {
    const p = noul(answers, `tool:${tool.id}`);
    return p >= PICK_THRESHOLD
      ? [{ id: tool.id, reason: `Jev: ${Math.round(p * 100)}% likely needed for this request.`, confidence: Math.round(p * 100) / 100 }]
      : [];
  });
}
/** Skills step: state is the builder's answers; result matches llmResultSchema. */
export function recommendRequest(input: { category: string; inputChips: string[]; outputChips: string[]; context: string }) {
  return {
    state: { request: input.context, category: input.category, starts_with: input.inputChips, gives_back: input.outputChips },
    questions: { ...toolQuestions(), ...requirementQuestions() },
  };
}
export function recommendFromAnswers(answers: Answers) {
  return { picks: picksFrom(answers), followUp: "", requirements: requirementsFrom(answers) };
}
/** Describe box: state is the sentence; result matches describeLlmSchema. Text fields stay with rules. */
export function describeRequest(description: string) {
  return {
    state: { request: description },
    questions: {
      category: {
        type: "choice" as const,
        instructions: "Which kind of helper is this agent?",
        criteria: Object.fromEntries(categories.map((c) => [c.id, `${c.name}: ${c.detail}`])),
      },
      ...toolQuestions(),
      ...requirementQuestions(),
    },
  };
}
export function describeFromAnswers(description: string, answers: Answers) {
  const category = choice(answers, "category");
  return {
    name: nameFromDescription(description).slice(0, 60),
    category: category && categories.some((c) => c.id === category.value) ? category.value : categories[0].id,
    inputChips: [],
    outputChips: [],
    tools: picksFrom(answers).map((pick) => pick.id).slice(0, 10),
    inputs: [],
    sections: [],
    method: [],
    whenToUse: "",
    topics: "",
    requirements: requirementsFrom(answers),
  };
}
/** Completeness check: one Noul per confirmed requirement, judged against the agent's own text. */
export function verifyRequest(requirements: Pick<Requirement, "id" | "type" | "value">[], agent: string) {
  return {
    state: { agent },
    questions: Object.fromEntries(
      requirements.map((r) => [
        `covers:${r.id}`,
        {
          type: "noul" as const,
          // A schedule is recorded in the agent; starting it is the host's job, so ask whether it's specified.
          instructions:
            r.type === "trigger"
              ? `Does this agent specify that it is meant to run ${cadencePhrase(r.value)}? It counts even if the host's scheduler has to start it.`
              : `Would this agent, as written, make this happen: "${requirementText(r)}"? Answer yes only if a step, setting, schedule, length target or boundary in the agent makes it happen and nothing in the agent contradicts it.`,
        },
      ]),
    ),
  };
}
export function verifyFromAnswers(requirements: Pick<Requirement, "id" | "type" | "value">[], answers: Answers) {
  return requirements.map((r) => {
    const p = noul(answers, `covers:${r.id}`);
    const covered = p >= COVERED_THRESHOLD;
    return {
      requirement_id: r.id,
      covered,
      where: "",
      problem: covered ? "" : `Jev found nothing in the agent that makes this happen (${Math.round(p * 100)}% likely covered).`,
      fix: covered ? "" : coverageHints[r.type],
    };
  });
}
