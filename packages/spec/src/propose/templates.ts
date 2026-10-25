import { z } from "zod";
import type {
  ColumnTemplate,
  OutputTemplate,
  SectionTemplate,
  ShapeRef,
  ValidationIssue,
} from "./model";

const text = z.string().trim().min(1).max(2000);
const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
    "Reserved identifier",
  );
export const columnTemplateSchema = z
  .object({
    id,
    name: text,
    type: z.enum([
      "text",
      "number",
      "currency",
      "date",
      "percent",
      "choice",
      "boolean",
      "url",
    ]),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    choices: z.array(text).max(100).optional(),
    formula: text.optional(),
    required: z.boolean(),
    description: text,
  })
  .strict();
export const sectionTemplateSchema = z
  .object({
    id,
    heading: text,
    purpose: text,
    role: id.optional(),
    contains: z.enum(["prose", "bullets", "table", "steps", "checklist"]),
    columns: z.array(columnTemplateSchema).min(1).max(20).optional(),
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().nonnegative().optional(),
    required: z.boolean(),
  })
  .strict();
export const chartTemplateSchema = z
  .object({ kind: z.enum(["bar", "line", "pie"]), x: id, y: id, title: text })
  .strict();
export const sortTemplateSchema = z
  .object({ column: id, dir: z.enum(["asc", "desc"]) })
  .strict();
export const totalTemplateSchema = z
  .object({ column: id, fn: z.enum(["sum", "avg", "count", "min", "max"]) })
  .strict();
export const sheetTemplateSchema = z
  .object({
    id,
    name: text,
    purpose: text,
    columns: z.array(columnTemplateSchema).min(1).max(20),
    sortBy: sortTemplateSchema.optional(),
    totals: z.array(totalTemplateSchema).max(20).optional(),
    groupBy: id.optional(),
    charts: z.array(chartTemplateSchema).max(20).optional(),
  })
  .strict();
const shapeRefSchema = z
  .object({ id: text, version: z.number().int().positive() })
  .strict();
const sections = z.array(sectionTemplateSchema).min(1).max(15);
const structuralTemplateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("spreadsheet"),
      sheets: z.array(sheetTemplateSchema).min(1).max(10),
    })
    .strict(),
  z.object({ kind: z.literal("document"), sections }).strict(),
  z.object({ kind: z.literal("action-plan"), sections }).strict(),
  z
    .object({
      kind: z.literal("chat-message"),
      sections,
      maxWords: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("live-panel"),
      rowIs: text,
      columns: z.array(columnTemplateSchema).min(1).max(20),
      refreshSeconds: z.number().positive().finite(),
    })
    .strict(),
  z.object({ kind: z.literal("data"), shape: shapeRefSchema }).strict(),
]);

export function formulaReferences(formula: string): string[] {
  const references = [...formula.matchAll(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g)].map(
    (match) => match[1],
  );
  if (/[{}]/.test(formula.replace(/\{[A-Za-z][A-Za-z0-9_-]*\}/g, "")))
    throw new Error("Malformed formula reference");
  return references;
}

export const outputTemplateSchema = structuralTemplateSchema.superRefine(
  (template, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    function unique(
      items: { id: string }[],
      labels: string[],
      path: (string | number)[],
    ) {
      const ids = new Set<string>(),
        names = new Set<string>();
      items.forEach((item, index) => {
        if (ids.has(item.id))
          issue([...path, index, "id"], "Identifiers must be unique");
        ids.add(item.id);
        const name = labels[index].trim().toLowerCase();
        if (names.has(name)) issue([...path, index], "Names must be unique");
        names.add(name);
      });
    }
    function columns(items: ColumnTemplate[], path: (string | number)[]) {
      unique(
        items,
        items.map((column) => column.name),
        path,
      );
      const ids = new Set(items.map((column) => column.id));
      const dependencies = new Map<string, string[]>();
      items.forEach((column, index) => {
        if (
          column.type === "choice" &&
          (!column.choices || new Set(column.choices).size < 2)
        )
          issue(
            [...path, index, "choices"],
            "Choose at least two distinct choices",
          );
        if (
          column.choices &&
          new Set(column.choices).size !== column.choices.length
        )
          issue([...path, index, "choices"], "Choices must be unique");
        if (column.formula) {
          try {
            const refs = formulaReferences(column.formula);
            dependencies.set(column.id, refs);
            if (refs.some((ref) => !ids.has(ref)))
              issue(
                [...path, index, "formula"],
                "Formula references a missing column",
              );
          } catch (error) {
            issue([...path, index, "formula"], (error as Error).message);
          }
        }
      });
      const visiting = new Set<string>(),
        visited = new Set<string>();
      function visit(key: string): boolean {
        if (visiting.has(key)) return false;
        if (visited.has(key)) return true;
        visiting.add(key);
        for (const next of dependencies.get(key) ?? [])
          if (!visit(next)) return false;
        visiting.delete(key);
        visited.add(key);
        return true;
      }
      if (items.some((column) => !visit(column.id)))
        issue(path, "Formula references must not form a cycle");
    }
    if (template.kind === "spreadsheet") {
      unique(
        template.sheets,
        template.sheets.map((sheet) => sheet.name),
        ["sheets"],
      );
      template.sheets.forEach((sheet, index) => {
        const path = ["sheets", index];
        columns(sheet.columns, [...path, "columns"]);
        const ids = new Set(sheet.columns.map((column) => column.id));
        const references = [
          sheet.sortBy?.column,
          sheet.groupBy,
          ...(sheet.totals ?? []).map((total) => total.column),
          ...(sheet.charts ?? []).flatMap((chart) => [chart.x, chart.y]),
        ];
        if (references.some((ref) => ref !== undefined && !ids.has(ref)))
          issue(
            path,
            "Sort, group, total and chart references must name existing columns",
          );
      });
    } else if ("sections" in template) {
      unique(
        template.sections,
        template.sections.map((section) => section.heading),
        ["sections"],
      );
      template.sections.forEach((section, index) => {
        if (section.contains === "table" && !section.columns)
          issue(["sections", index, "columns"], "A table needs columns");
        if (section.contains !== "table" && section.columns)
          issue(["sections", index, "columns"], "Only a table has columns");
        if (
          section.minItems !== undefined &&
          section.maxItems !== undefined &&
          section.minItems > section.maxItems
        )
          issue(
            ["sections", index],
            "Minimum items cannot exceed maximum items",
          );
        if (section.columns)
          columns(section.columns, ["sections", index, "columns"]);
      });
    } else if (template.kind === "live-panel")
      columns(template.columns, ["columns"]);
  },
);

export interface TemplateValidationOptions {
  requiredRoles?: readonly string[];
}
export function templateProblems(
  input: unknown,
  options: TemplateValidationOptions = {},
): ValidationIssue[] {
  const result = outputTemplateSchema.safeParse(input);
  if (!result.success)
    return result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      problem: issue.message,
      severity: "error",
    }));
  const template = result.data;
  const required = new Set([
    ...(options.requiredRoles ?? []),
    ...(template.kind === "action-plan"
      ? ["actions", "measurement", "assumptions"]
      : []),
  ]);
  const present = new Set(
    "sections" in template
      ? template.sections
          .filter((section) => section.required)
          .map((section) => section.role)
      : [],
  );
  return [...required]
    .filter((role) => !present.has(role))
    .map((role) => ({
      path: "sections",
      problem: `Keep a required section for ${role}`,
      severity: "error",
    }));
}

export function parseOutputTemplate(
  input: unknown,
  options: TemplateValidationOptions = {},
): OutputTemplate {
  const problems = templateProblems(input, options);
  if (problems.length)
    throw new Error(
      problems.map((issue) => `${issue.path}: ${issue.problem}`).join("; "),
    );
  return outputTemplateSchema.parse(input);
}

export type JsonSchema = Record<string, unknown>;
export type ShapeResolver = (ref: ShapeRef) => JsonSchema | undefined;
const objectSchema = (
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
function columnSchema(column: ColumnTemplate): JsonSchema {
  switch (column.type) {
    case "text":
      return { type: "string" };
    case "url":
      return { type: "string", format: "uri" };
    case "date":
      return { type: "string", format: "date" };
    case "boolean":
      return { type: "boolean" };
    case "choice":
      return { type: "string", enum: column.choices };
    default:
      return { type: "number" };
  }
}
function rowSchema(columns: ColumnTemplate[]): JsonSchema {
  const supplied = columns.filter((column) => !column.formula);
  return objectSchema(
    Object.fromEntries(
      supplied.map((column) => [column.id, columnSchema(column)]),
    ),
    supplied.filter((column) => column.required).map((column) => column.id),
  );
}
function sectionSchema(section: SectionTemplate): JsonSchema {
  if (section.contains === "prose") return { type: "string" };
  return {
    type: "array",
    items:
      section.contains === "table"
        ? rowSchema(section.columns!)
        : { type: "string" },
    ...(section.minItems === undefined ? {} : { minItems: section.minItems }),
    ...(section.maxItems === undefined ? {} : { maxItems: section.maxItems }),
  };
}

/** The one schema generator for sample generation, test drives and output contracts. */
export function templateToJsonSchema(
  input: OutputTemplate,
  resolveShape?: ShapeResolver,
): JsonSchema {
  const template = parseOutputTemplate(input);
  let schema: JsonSchema;
  if (template.kind === "data") {
    // SPEC-GAP: the spec omits how data templates resolve shapes. Require a caller-
    // supplied versioned resolver; never substitute an unconstrained schema.
    const resolved = resolveShape?.(template.shape);
    if (!resolved)
      throw new Error(
        `Unknown shape ${template.shape.id}@${template.shape.version}`,
      );
    schema = structuredClone(resolved);
  } else if (template.kind === "spreadsheet") {
    schema = objectSchema(
      {
        sheets: objectSchema(
          Object.fromEntries(
            template.sheets.map((sheet) => [
              sheet.id,
              objectSchema(
                { rows: { type: "array", items: rowSchema(sheet.columns) } },
                ["rows"],
              ),
            ]),
          ),
          template.sheets.map((sheet) => sheet.id),
        ),
      },
      ["sheets"],
    );
  } else if (template.kind === "live-panel") {
    schema = objectSchema(
      { rows: { type: "array", items: rowSchema(template.columns) } },
      ["rows"],
    );
  } else {
    schema = objectSchema(
      {
        sections: objectSchema(
          Object.fromEntries(
            template.sections.map((section) => [
              section.id,
              sectionSchema(section),
            ]),
          ),
          template.sections
            .filter((section) => section.required)
            .map((section) => section.id),
        ),
      },
      ["sections"],
    );
  }
  return { ...schema, $schema: "https://json-schema.org/draft/2020-12/schema" };
}
