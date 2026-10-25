import { z } from "zod";
import type {
  ColumnTemplate,
  OutputTemplate,
  SectionTemplate,
  SpreadsheetTemplate,
  TemplateEdit,
} from "./model";
import {
  chartTemplateSchema,
  columnTemplateSchema,
  parseOutputTemplate,
  sectionTemplateSchema,
  sheetTemplateSchema,
  sortTemplateSchema,
  totalTemplateSchema,
  type TemplateValidationOptions,
} from "./templates";

const editSchema = z
  .object({
    at: z.string().datetime({ offset: true }),
    by: z.enum(["click", "text"]),
    op: z.enum([
      "add",
      "remove",
      "rename",
      "move",
      "set-type",
      "set-choices",
      "set-formula",
      "set-required",
      "set-sort",
      "set-total",
      "set-group",
      "add-chart",
      "remove-chart",
    ]),
    target: z
      .object({
        sheet: z.string().optional(),
        column: z.string().optional(),
        section: z.string().optional(),
        chart: z.number().int().nonnegative().optional(),
      })
      .strict(),
    value: z.unknown().optional(),
    userText: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (edit) => edit.by !== "text" || edit.userText !== undefined,
    "Sentence edits need the original user text",
  );
const nonempty = z.string().trim().min(1).max(2000);

type Sheet = SpreadsheetTemplate["sheets"][number];
type Node = ColumnTemplate | SectionTemplate | Sheet;

function indexOf(items: { id: string }[], id: string): number {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Unknown edit target: ${id}`);
  return index;
}
function move<T>(items: T[], index: number, value: unknown) {
  const destination = z
    .number()
    .int()
    .min(0)
    .max(items.length - 1)
    .parse(value);
  const [item] = items.splice(index, 1);
  items.splice(destination, 0, item);
}

/**
 * SPEC-GAP: TemplateEdit.value is unspecified. This core uses: add = complete
 * node (appended, target id must match); move = zero-based destination index;
 * setters = replacement value; null clears an optional setting; set-total =
 * complete totals array. A table section's set-type value is {contains, columns};
 * other section types may use a string. Add then move expresses insertion.
 * A column set-type may use {type, choices?, currency?} to supply required choices
 * atomically. These conventions must also be used by the future editTemplate prompt.
 */
export function applyEdit(
  input: OutputTemplate,
  rawEdit: TemplateEdit,
  options: TemplateValidationOptions = {},
): OutputTemplate {
  // Parse into a fresh tree. Never mutate input, edit payloads, or partially apply a failure.
  const template = parseOutputTemplate(input, options);
  const edit = editSchema.parse(rawEdit);
  const target = edit.target;
  if (target.sheet !== undefined && target.section !== undefined)
    throw new Error("Choose a sheet or section, not both");
  if (target.chart !== undefined && edit.op !== "remove-chart")
    throw new Error("Chart index is only valid for remove-chart");
  if (template.kind === "data")
    throw new Error("Data templates are edited through their versioned shape");

  let sheet: Sheet | undefined;
  let section: SectionTemplate | undefined;
  if (target.sheet !== undefined) {
    if (template.kind !== "spreadsheet")
      throw new Error("This output has no sheets");
    if (!(edit.op === "add" && target.column === undefined))
      sheet = template.sheets[indexOf(template.sheets, target.sheet)];
  }
  if (target.section !== undefined) {
    if (!("sections" in template))
      throw new Error("This output has no sections");
    if (!(edit.op === "add" && target.column === undefined))
      section = template.sections[indexOf(template.sections, target.section)];
  }

  if (
    [
      "set-sort",
      "set-total",
      "set-group",
      "add-chart",
      "remove-chart",
    ].includes(edit.op)
  ) {
    if (!sheet || target.column !== undefined || target.section !== undefined)
      throw new Error("This edit needs a sheet target only");
    switch (edit.op) {
      case "set-sort":
        if (edit.value === null) delete sheet.sortBy;
        else sheet.sortBy = sortTemplateSchema.parse(edit.value);
        break;
      case "set-total":
        if (edit.value === null) delete sheet.totals;
        else
          sheet.totals = z.array(totalTemplateSchema).max(20).parse(edit.value);
        break;
      case "set-group":
        if (edit.value === null) delete sheet.groupBy;
        else sheet.groupBy = nonempty.parse(edit.value);
        break;
      case "add-chart":
        sheet.charts = [
          ...(sheet.charts ?? []),
          chartTemplateSchema.parse(edit.value),
        ];
        break;
      case "remove-chart": {
        const index = target.chart;
        if (
          index === undefined ||
          !sheet.charts ||
          index >= sheet.charts.length
        )
          throw new Error("Unknown chart");
        sheet.charts.splice(index, 1);
        break;
      }
    }
  } else {
    let items: Node[], id: string, nodeKind: "column" | "section" | "sheet";
    if (target.column !== undefined) {
      const columns =
        sheet?.columns ??
        section?.columns ??
        (template.kind === "live-panel" ? template.columns : undefined);
      if (!columns)
        throw new Error("Choose a sheet, table section or live panel column");
      items = columns;
      id = target.column;
      nodeKind = "column";
    } else if (target.section !== undefined && "sections" in template) {
      items = template.sections;
      id = target.section;
      nodeKind = "section";
    } else if (target.sheet !== undefined && template.kind === "spreadsheet") {
      items = template.sheets;
      id = target.sheet;
      nodeKind = "sheet";
    } else throw new Error("Choose a column, section or sheet");
    if (edit.op === "add") {
      if (items.some((item) => item.id === id))
        throw new Error(`Target already exists: ${id}`);
      const item =
        nodeKind === "column"
          ? columnTemplateSchema.parse(edit.value)
          : nodeKind === "section"
            ? sectionTemplateSchema.parse(edit.value)
            : sheetTemplateSchema.parse(edit.value);
      if (item.id !== id) throw new Error("New item id must match its target");
      items.push(item);
    } else {
      const index = indexOf(items, id);
      const node = items[index];
      switch (edit.op) {
        case "remove":
          items.splice(index, 1);
          break;
        case "move":
          move(items, index, edit.value);
          break;
        case "rename":
          if ("heading" in node) node.heading = nonempty.parse(edit.value);
          else node.name = nonempty.parse(edit.value);
          break;
        case "set-required":
          if (!("required" in node))
            throw new Error("Sheets do not have a required setting");
          node.required = z.boolean().parse(edit.value);
          break;
        case "set-type":
          if ("type" in node) {
            if (typeof edit.value === "string")
              node.type = columnTemplateSchema.shape.type.parse(edit.value);
            else {
              const value = columnTemplateSchema
                .pick({ type: true, choices: true, currency: true })
                .parse(edit.value);
              node.type = value.type;
              if (value.choices !== undefined) node.choices = value.choices;
              if (value.currency !== undefined) node.currency = value.currency;
            }
            if (node.type !== "choice") delete node.choices;
            if (node.type !== "currency") delete node.currency;
          } else if ("contains" in node) {
            if (typeof edit.value === "string") {
              node.contains = sectionTemplateSchema.shape.contains.parse(
                edit.value,
              );
              if (node.contains !== "table") delete node.columns;
            } else {
              const value = z
                .object({
                  contains: z.literal("table"),
                  columns: z.array(columnTemplateSchema).min(1).max(20),
                })
                .strict()
                .parse(edit.value);
              node.contains = value.contains;
              node.columns = value.columns;
            }
          } else throw new Error("Sheets do not have a content type");
          break;
        case "set-choices":
          if (!("type" in node) || node.type !== "choice")
            throw new Error("Only a choice column has choices");
          node.choices = z.array(nonempty).min(2).max(100).parse(edit.value);
          break;
        case "set-formula":
          if (!("type" in node)) throw new Error("Only a column has a formula");
          if (edit.value === null) delete node.formula;
          else node.formula = nonempty.parse(edit.value);
          break;
        default:
          throw new Error(`Unsupported edit: ${edit.op}`);
      }
    }
  }
  return parseOutputTemplate(template, options);
}

/** A sentence's edits are all-or-nothing, including validation of every intermediate edit. */
export function applyEdits(
  template: OutputTemplate,
  edits: readonly TemplateEdit[],
  options: TemplateValidationOptions = {},
): OutputTemplate {
  if (edits.length > 100) throw new Error("Too many edits in one change");
  return edits.reduce(
    (current, edit) => applyEdit(current, edit, options),
    parseOutputTemplate(template, options),
  );
}
