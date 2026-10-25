import { describe, expect, it } from "vitest";
import { column, document, spreadsheet } from "./fixtures.test-support";
import type { OutputTemplate } from "./model";
import {
  parseOutputTemplate,
  templateProblems,
  templateToJsonSchema,
} from "./templates";

const plan = (): OutputTemplate => ({
  kind: "action-plan",
  sections: ["actions", "measurement", "assumptions"].map((role) => ({
    id: role,
    heading: role,
    purpose: `Explain ${role}`,
    contains: "bullets",
    role,
    required: true,
  })),
});

describe("templateToJsonSchema", () => {
  const kinds: OutputTemplate[] = [
    spreadsheet(),
    document(),
    plan(),
    { ...document(), kind: "chat-message", maxWords: 200 },
    {
      kind: "live-panel",
      rowIs: "One agent",
      refreshSeconds: 5,
      columns: [column("name"), column("running", "boolean")],
    },
    { kind: "data", shape: { id: "Text", version: 1 } },
  ];
  it.each(kinds)("snapshots $kind", (template) => {
    expect(
      templateToJsonSchema(template, () => ({ type: "string" })),
    ).toMatchSnapshot();
  });
  it("maps every column type and excludes formulas from properties and required", () => {
    const template = spreadsheet();
    template.sheets[0].columns.push(
      column("number", "number"),
      column("date", "date"),
      column("percent", "percent"),
      { ...column("category", "choice"), choices: ["Food", "Travel"] },
      column("boolean", "boolean"),
      { ...column("url", "url"), required: false },
    );
    const schema = templateToJsonSchema(template);
    const row = (schema.properties as any).sheets.properties.transactions
      .properties.rows.items;
    expect(row).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string" },
        amount: { type: "number" },
        number: { type: "number" },
        date: { type: "string", format: "date" },
        percent: { type: "number" },
        category: { type: "string", enum: ["Food", "Travel"] },
        boolean: { type: "boolean" },
        url: { type: "string", format: "uri" },
      },
      required: [
        "description",
        "amount",
        "number",
        "date",
        "percent",
        "category",
        "boolean",
      ],
    });
    expect(JSON.stringify(schema)).not.toContain("tax");
  });
  it("maps every section content kind, bounds lists and closes all object levels", () => {
    const template = document();
    template.sections.push(
      {
        ...template.sections[0],
        id: "table",
        heading: "Table",
        contains: "table",
        columns: [column("amount", "number")],
      },
      {
        ...template.sections[1],
        id: "steps",
        heading: "Steps",
        contains: "steps",
      },
      {
        ...template.sections[1],
        id: "checklist",
        heading: "Checklist",
        contains: "checklist",
      },
    );
    expect(templateToJsonSchema(template)).toMatchSnapshot();
    function closed(value: unknown) {
      if (!value || typeof value !== "object") return;
      if ("type" in value && value.type === "object")
        expect(value).toHaveProperty("additionalProperties", false);
      Object.values(value).forEach(closed);
    }
    closed(templateToJsonSchema(template));
    closed(templateToJsonSchema(spreadsheet()));
  });
  it("requires an exact shape resolver and returns an independent schema", () => {
    const template: OutputTemplate = {
      kind: "data",
      shape: { id: "custom", version: 2 },
    };
    expect(() => templateToJsonSchema(template)).toThrow("custom@2");
    const shape = {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    };
    const schema = templateToJsonSchema(template, (ref) => {
      expect(ref).toEqual({ id: "custom", version: 2 });
      return shape;
    });
    (schema.properties as any).name.type = "number";
    expect(shape.properties.name.type).toBe("string");
  });
});

describe("template validation", () => {
  it("rejects unknown properties, empty structures and excessive sizes", () => {
    expect(() =>
      parseOutputTemplate({ ...document(), injected: true }),
    ).toThrow();
    expect(() =>
      parseOutputTemplate({ kind: "spreadsheet", sheets: [] }),
    ).toThrow();
    expect(() =>
      parseOutputTemplate({ kind: "document", sections: [] }),
    ).toThrow();
    const template = spreadsheet();
    template.sheets[0].columns = Array.from({ length: 21 }, (_, i) =>
      column(`c${i}`),
    );
    expect(() => parseOutputTemplate(template)).toThrow();
    template.sheets = Array.from({ length: 11 }, (_, i) => ({
      ...template.sheets[0],
      id: `s${i}`,
      name: `Sheet ${i}`,
      columns: [column("name")],
    }));
    expect(() => parseOutputTemplate(template)).toThrow();
    const doc = document();
    doc.sections = Array.from({ length: 16 }, (_, i) => ({
      ...doc.sections[0],
      id: `s${i}`,
      heading: `Section ${i}`,
    }));
    expect(() => parseOutputTemplate(doc)).toThrow();
  });
  it("rejects duplicate ids and case-insensitive names", () => {
    const template = spreadsheet();
    template.sheets[0].columns[1].name = " Description ";
    expect(() => parseOutputTemplate(template)).toThrow("Names must be unique");
    template.sheets[0].columns[1].name = "Amount";
    template.sheets[0].columns[1].id = "description";
    expect(() => parseOutputTemplate(template)).toThrow(
      "Identifiers must be unique",
    );
  });
  it("validates choices, formula references, malformed references and cycles", () => {
    const template = spreadsheet();
    template.sheets[0].columns.push({
      ...column("category", "choice"),
      choices: ["Only"],
    });
    expect(() => parseOutputTemplate(template)).toThrow("two distinct");
    template.sheets[0].columns.pop();
    template.sheets[0].columns[2].formula = "{missing}";
    expect(() => parseOutputTemplate(template)).toThrow("missing column");
    template.sheets[0].columns[2].formula = "{amount";
    expect(() => parseOutputTemplate(template)).toThrow("Malformed formula");
    template.sheets[0].columns[2].formula = "{amount}";
    template.sheets[0].columns[1].formula = "{tax}";
    expect(() => parseOutputTemplate(template)).toThrow("cycle");
  });
  it("rejects dangling sort, total, group and chart references", () => {
    for (const setting of [
      { sortBy: { column: "missing", dir: "asc" } },
      { groupBy: "missing" },
      { totals: [{ column: "missing", fn: "sum" }] },
      {
        charts: [
          { kind: "pie", x: "description", y: "missing", title: "Totals" },
        ],
      },
    ]) {
      const template = spreadsheet();
      Object.assign(template.sheets[0], setting);
      expect(() => parseOutputTemplate(template)).toThrow("references");
    }
  });
  it("protects action-plan and seed-specific required roles", () => {
    expect(templateProblems(plan())).toEqual([]);
    expect(
      templateProblems(document(), { requiredRoles: ["assumptions"] }),
    ).toHaveLength(1);
    const template = plan();
    if (!("sections" in template)) throw new Error("Expected sections");
    template.sections[0].required = false;
    expect(templateProblems(template)).toEqual([
      {
        path: "sections",
        problem: "Keep a required section for actions",
        severity: "error",
      },
    ]);
  });
  it("rejects unsafe IDs, bad section content, invalid counts and refresh rates", () => {
    const template = document();
    template.sections[0].contains = "table";
    expect(() => parseOutputTemplate(template)).toThrow("table needs columns");
    template.sections[0].columns = [column("constructor")];
    expect(() => parseOutputTemplate(template)).toThrow("Reserved identifier");
    template.sections[0].columns = [column("value")];
    template.sections[1].minItems = 6;
    expect(() => parseOutputTemplate(template)).toThrow("Minimum items");
    expect(() =>
      parseOutputTemplate({
        kind: "live-panel",
        rowIs: "Agent",
        columns: [column("name")],
        refreshSeconds: 0,
      }),
    ).toThrow();
  });
});
