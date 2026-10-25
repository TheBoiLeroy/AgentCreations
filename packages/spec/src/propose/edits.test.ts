import { describe, expect, it } from "vitest";
import { applyEdit, applyEdits } from "./edits";
import { column, document, edit, spreadsheet } from "./fixtures.test-support";
import type { OutputTemplate, TemplateEdit } from "./model";

const sheetTarget = { sheet: "transactions" };
const amountTarget = { ...sheetTarget, column: "amount" };
const descriptionTarget = { ...sheetTarget, column: "description" };
const taxTarget = { ...sheetTarget, column: "tax" };
function sheet(template: OutputTemplate) {
  if (template.kind !== "spreadsheet") throw new Error("Expected spreadsheet");
  return template.sheets[0];
}

describe("atomic template editing", () => {
  it("adds, moves, renames and removes columns without mutating the original", () => {
    const original = spreadsheet();
    const before = structuredClone(original);
    const result = applyEdits(original, [
      edit("add", { ...sheetTarget, column: "account" }, column("account")),
      edit("move", { ...sheetTarget, column: "account" }, 0),
      edit("rename", descriptionTarget, "Merchant"),
      edit("remove", taxTarget),
    ]);
    expect(original).toEqual(before);
    expect(
      sheet(result).columns.map((column) => [column.id, column.name]),
    ).toEqual([
      ["account", "account"],
      ["description", "Merchant"],
      ["amount", "amount"],
    ]);
  });
  it("supports reversed add/remove/rename/move edits", () => {
    const original = spreadsheet();
    const added = { ...sheetTarget, column: "account" };
    const result = applyEdits(original, [
      edit("add", added, column("account")),
      edit("move", added, 0),
      edit("rename", descriptionTarget, "Merchant"),
      edit("rename", descriptionTarget, "description"),
      edit("move", added, 3),
      edit("remove", added),
    ]);
    expect(result).toEqual(original);
    const removed = applyEdit(original, edit("remove", descriptionTarget));
    expect(
      applyEdits(removed, [
        edit("add", descriptionTarget, original.sheets[0].columns[0]),
        edit("move", descriptionTarget, 0),
      ]),
    ).toEqual(original);
  });
  it("supports every column setting, including atomically changing to choice", () => {
    const result = applyEdits(spreadsheet(), [
      edit("set-type", descriptionTarget, {
        type: "choice",
        choices: ["One", "Two"],
      }),
      edit("set-choices", descriptionTarget, ["Three", "Four"]),
      edit("set-required", descriptionTarget, false),
      edit("set-formula", taxTarget, "{amount} * 0.2"),
      edit("set-formula", taxTarget, null),
    ]);
    expect(sheet(result).columns[0]).toMatchObject({
      type: "choice",
      choices: ["Three", "Four"],
      required: false,
    });
    expect(sheet(result).columns[2]).not.toHaveProperty("formula");
    const text = applyEdit(result, edit("set-type", descriptionTarget, "text"));
    expect(sheet(text).columns[0]).not.toHaveProperty("choices");
  });
  it("adds, removes, renames and reorders sheets", () => {
    const original = spreadsheet();
    const newSheet = { ...original.sheets[0], id: "other", name: "Other" };
    const result = applyEdits(original, [
      edit("add", { sheet: "other" }, newSheet),
      edit("move", { sheet: "other" }, 0),
      edit("rename", { sheet: "other" }, "Second"),
      edit("remove", sheetTarget),
    ]);
    expect(sheet(result)).toMatchObject({ id: "other", name: "Second" });
    expect(newSheet.name).toBe("Other");
  });
  it("sets and clears sort, group, totals and charts", () => {
    const original = spreadsheet();
    const configured = applyEdits(original, [
      edit("set-sort", sheetTarget, { column: "amount", dir: "desc" }),
      edit("set-group", sheetTarget, "description"),
      edit("set-total", sheetTarget, [{ column: "amount", fn: "sum" }]),
      edit("add-chart", sheetTarget, {
        kind: "pie",
        x: "description",
        y: "amount",
        title: "Spending",
      }),
    ]);
    expect(sheet(configured)).toMatchObject({
      sortBy: { column: "amount", dir: "desc" },
      groupBy: "description",
      totals: [{ column: "amount", fn: "sum" }],
    });
    const cleared = applyEdits(configured, [
      edit("set-sort", sheetTarget, null),
      edit("set-group", sheetTarget, null),
      edit("set-total", sheetTarget, null),
      edit("remove-chart", { ...sheetTarget, chart: 0 }),
    ]);
    expect(sheet(cleared)).toEqual({ ...original.sheets[0], charts: [] });
  });
  it("edits sections and their table columns", () => {
    const original = document();
    const result = applyEdits(original, [
      edit("rename", { section: "summary" }, "Overview"),
      edit(
        "set-type",
        { section: "summary" },
        { contains: "table", columns: [column("name")] },
      ),
      edit(
        "add",
        { section: "summary", column: "amount" },
        column("amount", "currency"),
      ),
      edit("set-required", { section: "details" }, true),
      edit(
        "add",
        { section: "notes" },
        { ...original.sections[1], id: "notes", heading: "Notes" },
      ),
      edit("move", { section: "notes" }, 0),
      edit("remove", { section: "details" }),
      edit("set-type", { section: "summary" }, "steps"),
    ]);
    expect(result).toMatchObject({
      sections: [
        { id: "notes" },
        { id: "summary", heading: "Overview", contains: "steps" },
      ],
    });
    if (!("sections" in result)) throw new Error("Expected sections");
    expect(result.sections[1]).not.toHaveProperty("columns");
    expect(original.sections[0].heading).toBe("Summary");
  });
  it("edits panel columns", () => {
    const panel: OutputTemplate = {
      kind: "live-panel",
      rowIs: "An agent",
      refreshSeconds: 5,
      columns: [column("name")],
    };
    expect(
      applyEdit(panel, edit("rename", { column: "name" }, "Agent")),
    ).toMatchObject({ columns: [{ name: "Agent" }] });
  });
  it("preserves the entire original on any invalid intermediate edit", () => {
    const original = spreadsheet();
    const before = structuredClone(original);
    expect(() =>
      applyEdits(original, [
        edit("rename", descriptionTarget, "Merchant"),
        edit("remove", amountTarget),
      ]),
    ).toThrow("missing column");
    expect(original).toEqual(before);
    expect(() =>
      applyEdits(original, [
        edit("remove", amountTarget),
        edit("remove", taxTarget),
      ]),
    ).toThrow();
  });
  it.each<TemplateEdit>([
    edit("rename", amountTarget, "description"),
    edit("rename", { column: "amount" }, "Total"),
    edit("move", amountTarget, -1),
    edit("move", amountTarget, 10),
    edit("set-type", descriptionTarget, "choice"),
    edit("set-choices", amountTarget, ["A", "B"]),
    edit("set-required", sheetTarget, false),
    edit("set-formula", sheetTarget, "1"),
    edit("set-sort", amountTarget, { column: "amount", dir: "asc" }),
    edit("remove-chart", { ...sheetTarget, chart: 0 }),
    edit("rename", { sheet: "missing" }, "New"),
    edit("add", descriptionTarget, column("description")),
    edit("add", { ...sheetTarget, column: "new" }, column("different")),
    edit("rename", { ...sheetTarget, section: "summary" }, "New"),
    edit("rename", { ...amountTarget, chart: 0 }, "New"),
    { ...edit("rename", descriptionTarget, "New"), by: "text" },
  ])("rejects invalid or ambiguous edits: %j", (change) => {
    const original = spreadsheet();
    const before = structuredClone(original);
    expect(() => applyEdit(original, change)).toThrow();
    expect(original).toEqual(before);
  });
  it("cannot remove the last sheet, column or section", () => {
    expect(() =>
      applyEdit(spreadsheet(), edit("remove", sheetTarget)),
    ).toThrow();
    const doc = document();
    doc.sections.pop();
    expect(() =>
      applyEdit(doc, edit("remove", { section: "summary" })),
    ).toThrow();
    const panel: OutputTemplate = {
      kind: "live-panel",
      rowIs: "Agent",
      refreshSeconds: 5,
      columns: [column("name")],
    };
    expect(() =>
      applyEdit(panel, edit("remove", { column: "name" })),
    ).toThrow();
  });
  it("blocks deletion or weakening of protected roles until the caller confirms a kind change", () => {
    const plan: OutputTemplate = {
      kind: "action-plan",
      sections: ["actions", "measurement", "assumptions"].map((role) => ({
        id: role,
        role,
        heading: role,
        purpose: `Explain ${role}`,
        contains: "bullets",
        required: true,
      })),
    };
    expect(() =>
      applyEdit(plan, edit("remove", { section: "actions" })),
    ).toThrow("actions");
    expect(() =>
      applyEdit(plan, edit("set-required", { section: "actions" }, false)),
    ).toThrow("actions");
    expect(
      applyEdit(
        { ...plan, kind: "document" },
        edit("remove", { section: "actions" }),
      ),
    ).toMatchObject({ kind: "document" });
    expect(() =>
      applyEdit(
        { ...plan, kind: "document" },
        edit("remove", { section: "assumptions" }),
        { requiredRoles: ["assumptions"] },
      ),
    ).toThrow("assumptions");
  });
});
