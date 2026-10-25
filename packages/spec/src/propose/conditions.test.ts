import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  parseCondition,
  parseSpecPath,
  readSpecPath,
} from "./conditions";

const draft = {
  description: "Monitor agents in the terminal, not corporate rates.",
  working: {
    inputs: [{ kind: "file", formats: ["csv", "xlsx"] }],
    empty: null,
    zero: 0,
    flag: false,
    object: { b: 2, a: 1 },
  },
};
describe("safe condition interpreter", () => {
  it.each([
    [{ path: "working.inputs[0].kind", equals: "file" }, true],
    [{ path: "working.object", equals: { a: 1, b: 2 } }, true],
    [
      {
        path: "working.inputs",
        includes: { formats: ["csv", "xlsx"], kind: "file" },
      },
      true,
    ],
    [{ path: "working.inputs[0].formats", includes: "pdf" }, false],
    [{ path: "description", includes: "terminal" }, true],
    [{ path: "working.zero", exists: true }, true],
    [{ path: "working.flag", exists: true }, true],
    [{ path: "working.empty", exists: false }, true],
    [{ path: "working.missing", exists: false }, true],
    [{ descriptionMentions: ["IN THE TERMINAL"] }, true],
    [{ descriptionMentions: ["rate", "agent", "work"] }, false],
    [{ descriptionMentions: ["[a-z]+"] }, false],
    [
      {
        all: [
          { path: "working.zero", equals: 0 },
          { not: { path: "working.flag", equals: true } },
        ],
      },
      true,
    ],
    [
      {
        any: [
          { path: "working.zero", equals: 1 },
          { descriptionMentions: ["monitor"] },
        ],
      },
      true,
    ],
    [{ all: [] }, true],
    [{ any: [] }, false],
  ])("evaluates %j", (condition, expected) => {
    expect(evaluateCondition(condition, draft)).toBe(expected);
  });
  it.each([
    null,
    [],
    {},
    { unknown: true },
    { path: "description" },
    { path: "description", equals: undefined },
    { path: "description", equals: NaN },
    { path: "description", equals: new Date() },
    { path: "description", equals: new Map() },
    { path: "description", equals: "x", includes: "x" },
    { path: "description", exists: "yes" },
    { all: true },
    { descriptionMentions: [""] },
    { descriptionMentions: [1] },
    { any: [{ all: [] }, { bad: true }] },
    { all: [{ any: [] }, { bad: true }] },
  ])(
    "rejects malformed conditions even in unreachable branches: %j",
    (input) => {
      expect(() => evaluateCondition(input, draft)).toThrow();
    },
  );
  it.each([
    "",
    "inputs[-1]",
    "inputs[01]",
    "inputs[1.2]",
    "inputs[]",
    "inputs..kind",
    "inputs[0]kind",
    'inputs["kind"]',
    "__proto__.polluted",
    "working.constructor.name",
    "working.prototype",
  ])("rejects unsafe or malformed path %s", (path) => {
    expect(() => parseSpecPath(path)).toThrow();
  });
  it("never reads inherited properties", () => {
    expect(
      readSpecPath(Object.create({ hidden: true }), "hidden"),
    ).toBeUndefined();
    expect(readSpecPath(draft, "working.inputs[1].kind")).toBeUndefined();
  });
  it("bounds recursion and node counts", () => {
    let condition: unknown = { all: [] };
    for (let i = 0; i < 40; i++) condition = { not: condition };
    expect(() => parseCondition(condition)).toThrow("too complex");
    expect(() =>
      parseCondition({ all: Array.from({ length: 300 }, () => ({ all: [] })) }),
    ).toThrow("too complex");
    const cyclic: { not?: unknown } = {};
    cyclic.not = cyclic;
    expect(() => parseCondition(cyclic)).toThrow("too complex");
  });
});
