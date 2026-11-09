// What the user asked for, as a typed list. Each requirement is confirmed by the user,
// then must be covered by at least one place in the generated spec.
import { z } from "zod";

export const requirementTypes = [
  "delivery", // "email" | "conversation"
  "recipient", // "self" | "others"
  "length", // "<min>-<max> words"
  "trigger", // a cadence
  "topics", // free text
  "research", // "web"
  "tone", // free text, e.g. "neutral"
  "approval", // free text: what must wait for a yes
  "other", // free text the generator turns into a method step
] as const;
export const cadences = ["daily", "weekdays", "weekly", "monthly"] as const;
export type Cadence = (typeof cadences)[number];
export const requirementSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    type: z.enum(requirementTypes),
    value: z.string().trim().min(1).max(300),
    // The user's own words. Empty when Jev assumed it.
    quote: z.string().max(300),
    origin: z.enum(["stated", "assumed"]),
    // Spec locations that satisfy it, e.g. "method.3", "schedule", "settings.recipient".
    coveredBy: z.array(z.string().max(80)).max(10).default([]),
  })
  .strict();
export type Requirement = z.infer<typeof requirementSchema>;
export const requirementsSchema = z
  .array(requirementSchema)
  .max(20)
  .refine((list) => new Set(list.map((r) => r.id)).size === list.length, "Requirement ids must be unique");

export function wordRange(value: string): { minWords: number; maxWords: number } | undefined {
  const match = value.match(/^(\d{1,5})-(\d{1,5}) words$/);
  if (!match) return undefined;
  const range = { minWords: Number(match[1]), maxWords: Number(match[2]) };
  return range.minWords > 0 && range.minWords <= range.maxWords ? range : undefined;
}
/** Reading time at roughly 200–240 words a minute. */
export const minutesToRead = (range: { minWords: number }) => Math.max(1, Math.round(range.minWords / 200));
const cadenceText: Record<Cadence, string> = {
  daily: "every day",
  weekdays: "every weekday",
  weekly: "every week",
  monthly: "every month",
};
export const cadencePhrase = (value: string) => cadenceText[value as Cadence] || value;
/** One plain sentence per requirement, for the confirmation list. */
export function requirementText(r: Pick<Requirement, "type" | "value">): string {
  const range = r.type === "length" ? wordRange(r.value) : undefined;
  switch (r.type) {
    case "delivery":
      return r.value === "email" ? "Sends the result by email" : "Replies in the conversation";
    case "recipient":
      return r.value === "self" ? "The email goes to you, at an address you set" : "The email goes to other people";
    case "length":
      return range
        ? `About ${range.minWords.toLocaleString("en-US")}–${range.maxWords.toLocaleString("en-US")} words (a ${minutesToRead(range)}-minute read)`
        : `Length: ${r.value}`;
    case "trigger":
      return `Runs on its own ${cadencePhrase(r.value)}`;
    case "topics":
      return `Covers these topics: ${r.value}`;
    case "research":
      return "Looks things up on the web";
    case "tone":
      return `Tone: ${r.value}`;
    case "approval":
      return `Asks you first: ${r.value}`;
    case "other":
      return r.value;
  }
}
