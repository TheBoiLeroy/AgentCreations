// Requirements extraction: the request becomes a typed list before any spec is written,
// so "email me", "5 minute read" and "every week" can't be lost between request and export.
import { z } from "zod";
import {
  cadences,
  requirementsSchema,
  requirementTypes,
  wordRange,
  type Requirement,
} from "@agents/spec";

type Found = Omit<Requirement, "id" | "coveredBy">;
const days = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const cadenceRules: [Requirement["value"], RegExp][] = [
  ["weekdays", /\bweekdays?\b|\b(?:every|each)\s+(?:working|business|week)\s?day\b/i],
  ["daily", /\bdaily\b|\b(?:every|each)\s+(?:day|morning|evening|night)\b/i],
  ["weekly", new RegExp(`\\bweekly\\b|\\b(?:every|each)\\s+(?:week|${days})\\b`, "i")],
  ["monthly", /\bmonthly\b|\b(?:every|each)\s+month\b/i],
];
const selfEmail =
  /\be-?mail(?:s|ed|ing)?\s+(?:it\s+to\s+)?(?:me|us|myself)\b|\bsend(?:s|ing)?\s+(?:me|us)\b[^.]*?\b(?:e-?mail|inbox)\b|\bto\s+my\s+(?:inbox|e-?mail)\b/i;
const othersEmail =
  /\b(?:e-?mail(?:s|ing)?|send(?:s|ing)?\s+(?:an?\s+)?e-?mails?\s+to)\s+(?:my\s+|our\s+|the\s+)?(?:customers?|clients?|team|leads?|subscribers?|them|everyone)\b/i;
const researchWords =
  /\b(?:research(?:es|ing)?|news|latest|developments?|trends?|look(?:s|ing)?\s+up|search(?:es|ing)?\s+the\s+web)\b|\b(?:read|digest|newsletter|briefing|roundup|update)\s+(?:about|on)\b/i;
const standing = /\b(?:agent|assistant|bot|helper)\s+(?:that|which|to)\s+(?:will\s+)?(?:e-?mail|send)|\bkeep(?:s)?\s+me\s+(?:updated|posted|informed)\b/i;
const vagueTopics = /^(?:my|our|the|a|some|any)?\s*(?:current\s+)?(?:interests?|topics?|things|stuff|subjects?)$/i;
const first = (text: string, pattern: RegExp) => text.match(pattern)?.[0].trim().slice(0, 300);

/** Deterministic extraction. Stated requirements quote the request; the rest are marked assumed. */
export function extractRequirements(request: string): Requirement[] {
  const text = request.trim().replace(/\s+/g, " ");
  const found: Found[] = [];
  const stated = (type: Found["type"], value: string, quote: string) =>
    found.push({ type, value, quote, origin: "stated" });
  const assumed = (type: Found["type"], value: string) =>
    found.push({ type, value, quote: "", origin: "assumed" });
  const self = first(text, selfEmail);
  const others = first(text, othersEmail);
  if (self || others) {
    stated("delivery", "email", (others || self)!);
    stated("recipient", others ? "others" : "self", (others || self)!);
  } else assumed("delivery", "conversation");
  const minutes = text.match(/\b(\d{1,3})[\s-]*(?:minute|min)s?[\s-]+read\b/i);
  const range = text.match(/\b(\d{2,5})\s*(?:-|–|to)\s*(\d{2,5})\s+words?\b/i);
  const words = text.match(/\b(\d{2,5})[\s-]+words?\b/i);
  if (minutes) stated("length", `${Number(minutes[1]) * 200}-${Number(minutes[1]) * 240} words`, minutes[0]);
  else if (range && wordRange(`${Number(range[1])}-${Number(range[2])} words`))
    stated("length", `${Number(range[1])}-${Number(range[2])} words`, range[0]);
  else if (words)
    stated("length", `${Math.round(Number(words[1]) * 0.9)}-${Math.round(Number(words[1]) * 1.1)} words`, words[0]);
  const cadence = cadenceRules.find(([, pattern]) => pattern.test(text));
  if (cadence) stated("trigger", cadence[0], first(text, cadence[1])!);
  // "An agent that will email me…" is a standing job, not a one-off. Weekly is the shown default.
  else if (self && standing.test(text)) assumed("trigger", "weekly");
  const research = first(text, researchWords) || (self && first(text, /\babout\s+my\s+(?:current\s+)?interests\b/i));
  if (research) {
    stated("research", "web", research);
    const topic = text.match(/\b(?:about|on|covering)\s+(.+?)(?=\s+(?:and|then)\s+(?:e-?mail|send)|\s+(?:every|each|daily|weekly|monthly)\b|[.,;]|$)/i);
    if (topic && !vagueTopics.test(topic[1].trim())) stated("topics", topic[1].trim().slice(0, 300), topic[0]);
  }
  const tone = text.match(/\b(neutral|unbiased|balanced|friendly|formal|casual|professional|concise)\b/i);
  if (tone) stated("tone", tone[1].toLowerCase(), tone[0]);
  else if (research) assumed("tone", "neutral, with claims attributed to their sources");
  const ask = first(text, /\bask\s+(?:me\s+)?(?:before|first)\b[^.!?]*/i);
  if (ask) stated("approval", ask, ask);
  return withIds(found);
}
function withIds(found: Found[]): Requirement[] {
  const counts = new Map<string, number>();
  return requirementsSchema.parse(
    found.slice(0, 20).map((item) => {
      const n = (counts.get(item.type) || 0) + 1;
      counts.set(item.type, n);
      return { ...item, id: n === 1 ? item.type : `${item.type}-${n}`, coveredBy: [] };
    }),
  );
}
/** What the optional model may add. Typed values are checked; free text is bounded. */
export const llmRequirementsSchema = z
  .array(
    z
      .object({
        type: z.enum(requirementTypes),
        value: z.string().trim().min(1).max(300),
        quote: z.string().max(300),
        origin: z.enum(["stated", "assumed"]),
      })
      .strict(),
  )
  .max(12);
const validValue: Partial<Record<Requirement["type"], (value: string) => boolean>> = {
  delivery: (value) => value === "email" || value === "conversation",
  recipient: (value) => value === "self" || value === "others",
  length: (value) => !!wordRange(value),
  trigger: (value) => (cadences as readonly string[]).includes(value),
  research: (value) => value === "web",
};
const squash = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
/** Rules win where they found the user's words. The model fills types they missed and adds "other". */
export function mergeRequirements(request: string, rules: Requirement[], model: unknown): Requirement[] {
  const parsed = llmRequirementsSchema.safeParse(model);
  if (!parsed.success) return rules;
  const merged: Found[] = rules.map(({ type, value, quote, origin }) => ({ type, value, quote, origin }));
  const source = squash(request);
  for (const item of parsed.data) {
    if (validValue[item.type] && !validValue[item.type]!(item.value)) continue;
    // A "stated" requirement must quote the request; otherwise it is the model's assumption.
    const quoted = item.origin === "stated" && !!item.quote.trim() && source.includes(squash(item.quote));
    const next: Found = quoted ? item : { ...item, quote: "", origin: "assumed" };
    const index = item.type === "other" ? -1 : merged.findIndex((x) => x.type === item.type);
    if (index < 0) {
      if (item.type !== "other" || merged.filter((x) => x.type === "other").length < 5) merged.push(next);
    } else if (merged[index].origin === "assumed" && next.origin === "stated") merged[index] = next;
  }
  // Email to yourself can't be delivered "in the conversation" at the same time.
  const email = merged.some((x) => x.type === "delivery" && x.value === "email");
  return withIds(merged.filter((x) => email || x.type !== "recipient"));
}
/** Skills a requirement cannot be met without. */
export function requiredTools(requirements: Pick<Requirement, "type" | "value">[]): string[] {
  return [
    ...(requirements.some((r) => r.type === "research") ? ["web-search"] : []),
    ...(requirements.some((r) => r.type === "delivery" && r.value === "email") ? ["send-email"] : []),
  ];
}
