import { describe, expect, it } from "vitest";
import { buildReducer, initialState, snapshot } from "./build-machine";
import { proposeRules, recommendRules } from "@agents/jev";
const ready = buildReducer(initialState, {
  type: "new",
  id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
});
describe("creation step machine", () => {
  it("requires answers before advancing", () => {
    expect(
      buildReducer(ready, { type: "navigate", step: "name" }).draft.step,
    ).toBe("category");
    const category = buildReducer(ready, {
      type: "category",
      category: "information-analysis",
    });
    expect(
      buildReducer(category, { type: "navigate", step: "needs" }).error,
    ).toContain("name");
  });
  it("keeps answers and tool toggles when going back", () => {
    let state = buildReducer(ready, {
      type: "category",
      category: "creation-communication",
    });
    state = buildReducer(state, { type: "name", name: "Quote writer" });
    state = buildReducer(state, {
      type: "context",
      context: "Write a quote from my notes",
    });
    state = buildReducer(state, { type: "navigate", step: "jev" });
    state = buildReducer(state, {
      type: "recommended",
      result: recommendRules({
        category: "creation-communication",
        inputChips: [],
        outputChips: [],
        context: state.draft.context,
      }),
    });
    state = buildReducer(state, { type: "toggle-tool", id: "draft-text" });
    state = buildReducer(state, { type: "navigate", step: "needs" });
    expect(state.direction).toBe(-1);
    expect(state.draft.name).toBe("Quote writer");
    expect(state.draft.selectedTools).toEqual([]);
    state = buildReducer(state, { type: "navigate", step: "tools" });
    expect(state.draft.selectedTools).toEqual([]);
    expect(state.direction).toBe(1);
  });
  it("invalidates recommendations when needs change", () => {
    const changed = buildReducer(
      { ...ready, draft: { ...ready.draft, selectedTools: ["draft-text"] } },
      { type: "context", context: "New task" },
    );
    expect(changed.draft.selectedTools).toEqual([]);
  });
  it("ignores stale Jev responses after Back and metadata for another draft", () => {
    expect(
      buildReducer(ready, {
        type: "recommended",
        result: recommendRules({
          category: "information-analysis",
          inputChips: [],
          outputChips: [],
          context: "",
        }),
      }),
    ).toBe(ready);
    expect(
      buildReducer(ready, {
        type: "synced",
        id: "other",
        revision: 4,
        trigger: "wrong",
        agent: null,
      }),
    ).toBe(ready);
  });
});
describe("skill answer recovery", () => {
  it("preserves answers on restore and gates review when a newly selected skill needs an answer", () => {
    const answered = {
      ...ready,
      draft: { ...ready.draft, category: "information-analysis" as const, name: "Mailer", context: "research and email me", selectedTools: ["web-search", "send-email"], step: "review" as const, details: { ...ready.draft.details, skillAnswers: { topics: "Batteries", recipient: "owner@example.com" } } },
    };
    const restored = buildReducer(initialState, { type: "restore", snapshot: snapshot(answered) });
    expect(restored.draft.step).toBe("review");
    expect(restored.draft.details.skillAnswers).toEqual(answered.draft.details.skillAnswers);
    const incomplete = { ...answered, draft: { ...answered.draft, details: { ...answered.draft.details, skillAnswers: { topics: "Batteries" } } } };
    expect(buildReducer(initialState, { type: "restore", snapshot: snapshot(incomplete) }).draft.step).toBe("details");
    expect(buildReducer(incomplete, { type: "navigate", step: "review" }).error).toContain("Which email");
  });
});

describe("follow-up details", () => {
  const atTools = () => {
    let state = buildReducer(ready, { type: "category", category: "information-analysis" });
    state = buildReducer(state, { type: "name", name: "Estimates" });
    state = buildReducer(state, {
      type: "context",
      context: "Look at my previous estimates and generate an estimate for a new job.",
    });
    state = buildReducer(state, { type: "chip", group: "inputChips", id: "files" });
    state = buildReducer(state, { type: "navigate", step: "jev" });
    return buildReducer(state, {
      type: "recommended",
      result: recommendRules({
        category: "information-analysis",
        inputChips: ["files"],
        outputChips: [],
        context: state.draft.context,
      }),
    });
  };
  it("seeds suggestions on entry and blocks review until questions are answered", () => {
    let state = buildReducer(atTools(), { type: "navigate", step: "details" });
    expect(state.draft.details.seeded).toBe(true);
    expect(state.draft.details.method).toContain("per-unit rates");
    expect(state.draft.details.inputs.map((x) => x.type)).toEqual(["folder", "text"]);
    state = buildReducer(state, { type: "navigate", step: "review" });
    expect(state.draft.step).toBe("details");
    expect(state.error).toContain("Describe input 1");
    state = buildReducer(state, {
      type: "details",
      patch: {
        inputs: [
          { label: "Past estimates", type: "folder", formats: ["pdf"], required: true },
          { label: "New job", type: "text", formats: [], required: true },
        ],
        whenToUse: "Use when the user wants an estimate for a new job.",
      },
    });
    state = buildReducer(state, { type: "navigate", step: "review" });
    expect(state.draft.step).toBe("review");
    expect(buildReducer(state, { type: "created", trigger: "estimates" }).error).toContain("Confirm what Jev understood");
    state = buildReducer(state, { type: "requirements-confirm" });
    state = buildReducer(state, { type: "created", trigger: "estimates" });
    expect(state.agent?.inputs.map((x) => x.name)).toEqual(["pastEstimates", "newJob"]);
    // Back keeps the answers.
    state = buildReducer(state, { type: "navigate", step: "tools" });
    state = buildReducer(state, { type: "navigate", step: "details" });
    expect(state.draft.details.inputs[0].label).toBe("Past estimates");
  });
  it("restores unanswered review steps to the details page", () => {
    const state = atTools();
    const restored = buildReducer(initialState, {
      type: "restore",
      snapshot: { ...snapshot(state), draft: { ...state.draft, step: "review" } },
    });
    expect(restored.draft.step).toBe("details");
    expect(restored.draft.details.seeded).toBe(true);
  });
});

describe("describe-to-create", () => {
  const files = "Read my PDF contracts and summarize the risks";
  it("lands a complete proposal on review, keeps it through Back and creates the agent", () => {
    let state = buildReducer(ready, { type: "proposed", proposal: proposeRules(files) });
    expect(state.draft.step).toBe("review");
    expect(state.draft.assumed.length).toBeGreaterThan(3);
    state = buildReducer(state, { type: "navigate", step: "details" });
    state = buildReducer(state, { type: "navigate", step: "tools" });
    expect(state.draft.selectedTools).toContain("read-files");
    state = buildReducer(state, { type: "navigate", step: "review" });
    expect(state.error).toBe("");
    state = buildReducer(state, { type: "requirements-confirm" });
    state = buildReducer(state, { type: "created", trigger: "contracts" });
    expect(state.error).toBe("");
    expect(state.agent?.inputs.map((x) => x.label)).toEqual(["Files to work from", "Details for this run"]);
    const restored = buildReducer(initialState, { type: "restore", snapshot: snapshot(state) });
    expect(restored.draft.assumed).toEqual(state.draft.assumed);
  });
  it("sends unanswered questions to details and ignores a stale proposal", () => {
    const state = buildReducer(ready, { type: "proposed", proposal: proposeRules("research a topic and email me") });
    expect(state.draft.step).toBe("details");
    expect(state.notice).toContain("2 answers still needed");
    expect(buildReducer(state, { type: "proposed", proposal: proposeRules(files) })).toBe(state);
  });
  it("drops the assumptions once the user edits the draft", () => {
    const state = buildReducer(ready, { type: "proposed", proposal: proposeRules(files) });
    expect(buildReducer(state, { type: "context", context: "Something else" }).draft.assumed).toEqual([]);
    expect(buildReducer(state, { type: "name", name: "Contracts" }).draft.assumed).toEqual([]);
    expect(buildReducer(state, { type: "details", patch: { template: "Risks" } }).draft.assumed).toEqual([]);
    expect(buildReducer(state, { type: "toggle-tool", id: "read-files" }).draft.assumed).toEqual([]);
  });
});
