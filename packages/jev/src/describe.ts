// Describe-to-create: one sentence in, a complete editable draft out.
// Everything Jev fills in is listed in `draft.assumed` so the user sees each default.
import { z } from "zod";
import {
  askPattern,
  categories,
  categorySchema,
  draftSchema,
  emptyDraft,
  hasWord,
  inputTypes,
  isPlaceholder,
  type BuildDetails,
  type BuildDraft,
} from "@agents/spec";
import { getSkillSource, getTool, inputChips, outputChips } from "./catalog";
import {
  isVagueWhenToUse,
  pendingQuestions,
  recommendRules,
  resolvedRuntime,
  skillQuestions,
  suggestDetails,
  usesSkillQuestions,
  modelMayPick,
} from "./index";
import { mergeRequirements, requiredTools } from "./requirements";

type Category = z.infer<typeof categorySchema>;
export const describeInputSchema = z
  .object({ description: z.string().trim().min(8).max(4000) })
  .strict();
export const proposalSchema = z
  .object({
    draft: draftSchema,
    mode: z.enum(["rules", "enhanced", "fallback"]),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;

const chipId = (chips: readonly { id: string }[]) =>
  z.string().refine((id) => chips.some((chip) => chip.id === id), "Unknown chip");
/** What the optional model may suggest. Ids are catalog-only; text is bounded. */
export const describeLlmSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    category: categorySchema,
    inputChips: z.array(chipId(inputChips)).max(6),
    outputChips: z.array(chipId(outputChips)).max(6),
    tools: z
      .array(z.string().refine((id) => !!getTool(id), "Unknown catalog tool"))
      .max(10),
    inputs: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(200),
            type: z.enum(inputTypes),
            formats: z.array(z.string().regex(/^[a-z0-9]{1,10}$/)).max(10),
            required: z.boolean(),
          })
          .strict(),
      )
      .max(6),
    sections: z.array(z.string().trim().min(1).max(200)).max(8),
    method: z.array(z.string().trim().min(1).max(500)).max(8),
    whenToUse: z.string().trim().max(1024),
    topics: z.string().trim().max(500),
    // Validated by mergeRequirements so a bad list never discards the rest.
    requirements: z.unknown().optional(),
  })
  .strict();
type Guess = Partial<z.infer<typeof describeLlmSchema>> & {
  name: string;
  category: Category;
  inputChips: string[];
  outputChips: string[];
};

const categoryWords: Record<Category, string[]> = {
  "information-analysis": [
    "research", "analyze", "analyse", "summarize", "summarise", "summary", "find",
    "compare", "report", "data", "insights", "digest", "news", "estimate", "estimates",
  ],
  "creation-communication": [
    "write", "writes", "draft", "drafts", "reply", "replies", "post", "posts", "blog",
    "proposal", "quote", "presentation", "design", "newsletter", "copy",
  ],
  "action-automation": [
    "automate", "automatically", "send", "sends", "update", "updates", "schedule",
    "every day", "daily", "weekly", "book", "sync",
  ],
  "support-oversight": [
    "review", "reviews", "check", "checks", "monitor", "watch", "track", "audit",
    "proofread", "alert", "running", "status",
  ],
  "planning-reasoning": [
    "plan", "plans", "roadmap", "prioritize", "prioritise", "decide", "strategy",
    "brainstorm", "organize", "organise",
  ],
};
const inputWords: Record<string, string[]> = {
  files: ["file", "files", "folder", "pdf", "pdfs", "document", "documents", "docs"],
  spreadsheet: ["spreadsheet", "spreadsheets", "csv", "excel", "xlsx"],
  "web-pages": ["website", "websites", "web page", "web pages", "url", "urls"],
  emails: ["inbox", "my email", "my emails", "customer emails", "incoming emails", "gmail"],
  "crm-records": ["crm", "customer records"],
};
const outputWords: Record<string, string[]> = {
  summary: ["summary", "summarize", "summarise", "digest", "recap", "brief"],
  draft: ["draft", "drafts"],
  plan: ["plan", "roadmap"],
  review: ["feedback", "review", "proofread"],
  "sent-email": ["email me", "send email", "send an email", "send emails"],
  "slide-deck": ["slide deck", "slides", "powerpoint", "presentation"],
  "spreadsheet-file": ["excel file", "xlsx file"],
  "live-panel": [
    "live panel", "panel", "dashboard", "widget", "in the terminal", "in my terminal",
    "agents running", "running agents",
  ],
  "status-line": ["status line", "status bar"],
};
const matching = (text: string, words: Record<string, string[]>) =>
  Object.entries(words)
    .filter(([, list]) => list.some((word) => hasWord(text, word)))
    .map(([id]) => id);

const lead =
  /^(?:please\s+)?(?:(?:i\s+(?:want|need|would\s+like)|i['’]d\s+like)\s+)?(?:to\s+)?(?:(?:create|build|make|have|get|give)\s+)?(?:me\s+)?(?:(?:an?|the|my)\s+)?(?:ai\s+)?(?:(?:agent|assistant|bot|helper)\b\s*)?(?:(?:that|which|who|to|for)\s+)?/i;
/** The job itself, without “I want an agent that …”. */
export function taskPhrase(description: string) {
  return description.trim().replace(/\s+/g, " ").replace(lead, "").replace(/[.!\s]+$/, "");
}
const stopwords = new Set(
  "a an the my me and of to for in on with that it its i all every each from into then them this our your is are be can will should please some any at by or what when so".split(" "),
);
export function nameFromDescription(description: string) {
  const words = taskPhrase(description.split(/[.!?\n]/)[0] || "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !stopwords.has(word.toLowerCase()))
    .slice(0, 3)
    .map((word) =>
      word === word.toUpperCase() ? word : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    );
  return words.join(" ").slice(0, 80) || "New helper";
}
function guessFromRules(text: string): Guess {
  const scores = categories.map(
    (category) => categoryWords[category.id].filter((word) => hasWord(text, word)).length,
  );
  return {
    name: nameFromDescription(text),
    category: categories[scores.indexOf(Math.max(...scores))].id,
    inputChips: matching(text, inputWords),
    outputChips: matching(text, outputWords),
  };
}

const defaultLabels: Record<(typeof inputTypes)[number], string> = {
  folder: "Files to work from",
  file: "Spreadsheet to analyze",
  connection: "Customer records from the connected app",
  text: "Details for this run",
};
const short = (value: string) => (value.length > 296 ? `${value.slice(0, 295)}…` : value);
const firstEmail = (text: string) =>
  text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/)?.[0];

function assemble(description: string, guess: Guess, mode: Proposal["mode"]): Proposal {
  const text = description.trim();
  const rules = recommendRules({
    category: guess.category,
    inputChips: guess.inputChips,
    outputChips: guess.outputChips,
    context: text,
  });
  const chipLabels = new Map(
    [...inputChips, ...outputChips].flatMap((chip) =>
      chip.tools.map((tool) => [tool as string, chip.label] as const),
    ),
  );
  // Nobody clicked a chip here, so the reason must not claim a choice.
  const recommendations = rules.recommendations.map((pick) =>
    pick.source === "chip"
      ? { ...pick, reason: `Your description suggests “${chipLabels.get(pick.id)}”.`, confidence: 0.75 }
      : pick,
  );
  const requirements = mergeRequirements(text, rules.requirements, guess.requirements);
  for (const id of [...(guess.tools || []).filter((id) => modelMayPick(id, text, guess.inputChips)), ...requiredTools(requirements)])
    if (!recommendations.some((pick) => pick.id === id))
      recommendations.push({
        id,
        reason: "Jev’s model read this from your description.",
        confidence: 0.7,
        source: "llm",
      });
  // External skills need a manual install and stop the Pi export, so a keyword alone
  // only suggests them. The user switches them on from the skills page.
  const optional = (pick: (typeof recommendations)[number]) =>
    pick.source !== "chip" && !!getSkillSource(pick.id);
  const base: BuildDraft = {
    ...emptyDraft,
    category: guess.category,
    name: guess.name.slice(0, 80),
    inputChips: guess.inputChips,
    outputChips: guess.outputChips,
    context: text,
    recommendations,
    selectedTools: recommendations.filter((pick) => !optional(pick)).map((pick) => pick.id),
    noticed: rules.noticed,
    requirements,
    step: "review",
  };
  const details: BuildDetails = suggestDetails(base);
  const runtime = resolvedRuntime({ ...base, details });
  const assumed = [
    `Category: ${categories.find((c) => c.id === guess.category)!.name}.`,
    `Name: “${base.name}”. Rename it and the command changes with it.`,
    base.selectedTools.length
      ? `Skills: ${base.selectedTools.map((id) => getTool(id)!.name).join(", ")}.`
      : "Skills: none. It works from what you give it.",
    runtime === "worker"
      ? "Runs once each time you call it, then replies."
      : "Keeps running in the terminal and shows live state.",
    ...(recommendations.some(optional)
      ? [
          `Suggested but off, because they need a manual install: ${recommendations
            .filter(optional)
            .map((pick) => getTool(pick.id)!.name)
            .join(", ")}.`,
        ]
      : []),
  ];
  if (usesSkillQuestions(base)) {
    const ids = new Set(skillQuestions(base).map((q) => q.id));
    const email = firstEmail(text);
    const topics = guess.topics || requirements.find((r) => r.type === "topics")?.value;
    if (ids.has("topics") && topics) {
      details.skillAnswers = { ...details.skillAnswers, topics };
      assumed.push(`Research topics: ${topics}.`);
    }
    if (ids.has("recipient") && email) {
      details.skillAnswers = { ...details.skillAnswers, recipient: email };
      assumed.push(`Sends to ${email}, the address in your description.`);
    }
  } else if (runtime === "worker") {
    const suggested = (guess.inputs || []).filter((input) => !isPlaceholder(input.label));
    details.inputs = (
      suggested.length
        ? suggested.map((input) => {
            const files = input.type === "file" || input.type === "folder";
            return {
              ...input,
              formats: !files ? [] : input.formats.length ? input.formats : ["pdf", "docx", "md", "txt"],
            };
          })
        : details.inputs.map((input) => ({ ...input, label: defaultLabels[input.type] }))
    ).sort((a, b) => Number(b.required) - Number(a.required));
    details.template =
      (guess.sections || []).filter((s) => !isPlaceholder(s)).join("\n") ||
      details.template ||
      "Result\nAssumptions";
    const steps = (guess.method || []).filter((step) => !askPattern.test(step));
    if (steps.length) details.method = steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
    // Left blank, the spec composes the trigger sentence from its parts; the request is never pasted in.
    details.whenToUse = guess.whenToUse && !isVagueWhenToUse(guess.whenToUse) ? guess.whenToUse : "";
    // "Ask me before…" needs a mode that is allowed to ask.
    if (askPattern.test(text)) {
      details.conversation = "followUp";
      assumed.push("It may ask one short question and continue on the next run, because you said “ask”.");
    }
    assumed.push(
      `Starts with: ${details.inputs.map((input) => input.label).join(", ")}.`,
      `The result has these sections: ${details.template.split("\n").join(", ")}.`,
    );
  } else if (details.dataSources.length) {
    assumed.push(`Watches: ${details.dataSources.join(", ")}.`);
  }
  const draft = { ...base, details, assumed: assumed.map(short).slice(0, 20) };
  return proposalSchema.parse({
    draft: { ...draft, step: pendingQuestions(draft).length ? "details" : "review" },
    mode,
  });
}
/** Deterministic proposal. Always available, including offline. */
export function proposeRules(description: string): Proposal {
  const { description: text } = describeInputSchema.parse({ description });
  return assemble(text, guessFromRules(text), "rules");
}
export type DescribeLlmPass = (description: string, signal: AbortSignal) => Promise<unknown>;
/** Rules first; a validated model pass may refine them within the deadline. */
export async function propose(
  description: string,
  llm?: DescribeLlmPass,
  timeoutMs = 8000,
): Promise<Proposal> {
  const { description: text } = describeInputSchema.parse({ description });
  const rules = guessFromRules(text);
  if (!llm) return assemble(text, rules, "rules");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Jev timeout"));
      }, timeoutMs);
    });
    const result = describeLlmSchema.parse(
      await Promise.race([Promise.resolve().then(() => llm(text, controller.signal)), timeout]),
    );
    // Chips the rules found in the user's own words stay.
    return assemble(
      text,
      {
        ...result,
        inputChips: [...new Set([...rules.inputChips, ...result.inputChips])],
        outputChips: [...new Set([...rules.outputChips, ...result.outputChips])],
      },
      "enhanced",
    );
  } catch {
    return assemble(text, rules, "fallback");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
