import { z } from "zod";

export const skillInputSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  question: z.string().trim().min(1).max(300),
  label: z.string().trim().min(1).max(200),
  type: z.enum(["text", "email", "schedule"]),
  required: z.boolean(),
  default: z.string().max(2000).optional(),
}).strict();
export const skillRecordSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  category: z.enum(["Research", "Communication", "Files", "Data", "Dev"]),
  tier: z.enum(["built-in", "shared", "custom"]),
  source: z.enum(["builtin", "generated", "imported_skill", "mcp"]),
  source_url: z.string().url().nullable(),
  version: z.string().min(1).max(100),
  owner_id: z.string().uuid().nullable(),
  visibility: z.enum(["private", "public"]),
  inputs: z.array(skillInputSchema).max(10),
  permissions: z.object({
    sends_email: z.boolean(), reads_files: z.boolean(), network: z.boolean(), posts_publicly: z.boolean(),
  }).strict(),
  requires_model_run: z.boolean(),
  supported_runtimes: z.array(z.enum(["worker", "extension"])).min(1).max(2),
  tested: z.boolean(),
}).strict();
export type SkillRecord = z.infer<typeof skillRecordSchema>;
export type SkillInput = z.infer<typeof skillInputSchema>;

/** Same semantic input ID means one answer, not one question per skill. */
export function mergeSkillInputs(skills: Pick<SkillRecord, "inputs">[]): SkillInput[] {
  const result = new Map<string, SkillInput>();
  for (const skill of skills) for (const input of skill.inputs) {
    const previous = result.get(input.id);
    if (previous && (previous.type !== input.type || previous.default !== input.default))
      throw new Error(`Conflicting skill input: ${input.id}`);
    result.set(input.id, { ...input, required: input.required || !!previous?.required });
  }
  return [...result.values()];
}
