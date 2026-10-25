import type {
  ColumnTemplate,
  DocumentTemplate,
  SpreadsheetTemplate,
  TemplateEdit,
} from "./model";

export const column = (
  id: string,
  type: ColumnTemplate["type"] = "text",
): ColumnTemplate => ({
  id,
  name: id,
  type,
  required: true,
  description: `Value for ${id}`,
});
export const spreadsheet = (): SpreadsheetTemplate => ({
  kind: "spreadsheet",
  sheets: [
    {
      id: "transactions",
      name: "Transactions",
      purpose: "One row per transaction",
      columns: [
        column("description"),
        column("amount", "currency"),
        { ...column("tax", "currency"), formula: "{amount} * 0.1" },
      ],
    },
  ],
});
export const document = (): DocumentTemplate => ({
  kind: "document",
  sections: [
    {
      id: "summary",
      heading: "Summary",
      purpose: "Summarize the findings",
      contains: "prose",
      required: true,
    },
    {
      id: "details",
      heading: "Details",
      purpose: "Explain the findings",
      contains: "bullets",
      required: false,
      minItems: 2,
      maxItems: 5,
    },
  ],
});
export const edit = (
  op: TemplateEdit["op"],
  target: TemplateEdit["target"],
  value?: unknown,
): TemplateEdit => ({
  at: "2026-10-19T00:00:00.000Z",
  by: "click",
  op,
  target,
  ...(value === undefined ? {} : { value }),
});
