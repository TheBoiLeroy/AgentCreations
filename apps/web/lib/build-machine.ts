import {
  agentSchema,
  draftSchema,
  specProblems,
  emptyDraft,
  steps,
  type AgentSpec,
  type BuildDetails,
  type BuildDraft,
  type BuildStep,
} from "@agents/spec";
import {
  createAgentSpec,
  pendingQuestions,
  suggestDetails,
  validateDraftCatalog,
  type JevResult,
} from "@agents/jev";
import { z } from "zod";
export const snapshotSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    trigger: z.string(),
    draft: draftSchema,
    agent: agentSchema.nullable(),
  })
  .superRefine((value, context) => {
    try {
      validateDraftCatalog(value.draft);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Draft contains unknown chips or tools.",
      });
    }
  });
export type Snapshot = z.infer<typeof snapshotSchema>;
export interface BuildState extends Snapshot {
  ready: boolean;
  direction: number;
  error: string;
  notice: string;
}
export const initialState: BuildState = {
  id: "",
  revision: 0,
  trigger: "",
  draft: emptyDraft,
  agent: null,
  ready: false,
  direction: 1,
  error: "",
  notice: "",
};
export type Action =
  | { type: "restore"; snapshot: Snapshot }
  | { type: "new"; id: string }
  | { type: "category"; category: NonNullable<BuildDraft["category"]> }
  | { type: "name"; name: string }
  | { type: "chip"; group: "inputChips" | "outputChips"; id: string }
  | { type: "context"; context: string }
  | { type: "navigate"; step: BuildStep }
  | { type: "recommended"; result: JevResult }
  | { type: "toggle-tool"; id: string }
  | { type: "details"; patch: Partial<BuildDetails> }
  | { type: "reset-details" }
  | { type: "created"; trigger: string }
  | {
      type: "synced";
      id: string;
      revision: number;
      trigger: string;
      agent: AgentSpec | null;
    }
  | { type: "error"; message: string }
  | { type: "notice"; message: string };
const invalidate = (
  state: BuildState,
  patch: Partial<BuildDraft>,
): BuildState => ({
  ...state,
  draft: {
    ...state.draft,
    ...patch,
    recommendations: [],
    selectedTools: [],
    noticed: [],
    followUp: "",
  },
  agent: null,
  error: "",
});
const detailsIndex = steps.indexOf("details");
const seeded = (draft: BuildDraft): BuildDraft =>
  draft.details.seeded ? draft : { ...draft, details: suggestDetails(draft) };
export function buildReducer(state: BuildState, action: Action): BuildState {
  switch (action.type) {
    case "restore": {
      const restored = { ...initialState, ...action.snapshot, ready: true };
      let step = restored.draft.step;
      if (!restored.draft.category) step = "category";
      else if (!restored.draft.name.trim() && steps.indexOf(step) > 1)
        step = "name";
      else if (
        !restored.draft.context.trim() &&
        (!restored.draft.inputChips.length ||
          !restored.draft.outputChips.length) &&
        steps.indexOf(step) > 2
      )
        step = "needs";
      else if (
        steps.indexOf(step) > detailsIndex &&
        !(step === "install" && restored.agent) &&
        pendingQuestions(restored.draft).length
      )
        step = "details";
      else if (step === "install" && !restored.agent) step = "review";
      const draft = { ...restored.draft, step };
      return { ...restored, draft: step === "details" ? seeded(draft) : draft };
    }
    case "new":
      return {
        ...initialState,
        id: action.id,
        draft: { ...emptyDraft },
        ready: true,
      };
    case "category":
      return state.draft.category === action.category
        ? state
        : {
            ...invalidate(state, { category: action.category }),
            notice: "Added to agent build",
          };
    case "name":
      return {
        ...state,
        draft: { ...state.draft, name: action.name },
        agent: null,
        error: "",
      };
    case "chip":
      return invalidate(state, {
        [action.group]: state.draft[action.group].includes(action.id)
          ? state.draft[action.group].filter((id) => id !== action.id)
          : [...state.draft[action.group], action.id],
      });
    case "context":
      return invalidate(state, { context: action.context });
    case "navigate": {
      if (action.step !== "category" && !state.draft.category)
        return { ...state, error: "Choose a category first." };
      if (steps.indexOf(action.step) > 1 && !state.draft.name.trim())
        return { ...state, error: "Give your agent a name." };
      if (
        steps.indexOf(action.step) > 2 &&
        !state.draft.context.trim() &&
        (!state.draft.inputChips.length || !state.draft.outputChips.length)
      )
        return {
          ...state,
          error: "Choose an input and output, or describe the task.",
        };
      const pending =
        steps.indexOf(action.step) > detailsIndex
          ? pendingQuestions(state.draft)
          : [];
      if (pending.length) return { ...state, error: pending[0].question };
      const next = { ...state.draft, step: action.step };
      return {
        ...state,
        direction:
          steps.indexOf(action.step) < steps.indexOf(state.draft.step) ? -1 : 1,
        draft: action.step === "details" ? seeded(next) : next,
        error: "",
        notice: "",
      };
    }
    case "recommended":
      return state.draft.step !== "jev"
        ? state
        : {
            ...state,
            draft: {
              ...state.draft,
              step: "tools",
              recommendations: action.result.recommendations,
              selectedTools: action.result.recommendations.map((r) => r.id),
              noticed: action.result.noticed,
              followUp: action.result.followUp,
            },
            direction: 1,
            notice:
              action.result.mode === "fallback"
                ? "Jev’s model was unavailable. Your rule-based recommendations are ready."
                : "",
            error: "",
          };
    case "toggle-tool":
      return {
        ...state,
        draft: {
          ...state.draft,
          selectedTools: state.draft.selectedTools.includes(action.id)
            ? state.draft.selectedTools.filter((id) => id !== action.id)
            : [...state.draft.selectedTools, action.id],
        },
        agent: null,
      };
    case "details":
      return {
        ...state,
        draft: {
          ...state.draft,
          details: { ...state.draft.details, ...action.patch, seeded: true },
        },
        agent: null,
        error: "",
      };
    case "reset-details":
      return {
        ...state,
        draft: {
          ...state.draft,
          details: suggestDetails({
            ...state.draft,
            details: { ...state.draft.details, runtime: "" },
          }),
        },
        agent: null,
        error: "",
      };
    case "created": {
      try {
        const agent = createAgentSpec(state.draft, action.trigger);
        const problems = specProblems(agent);
        if (problems.length) throw new Error(problems[0].message);
        return {
          ...state,
          agent,
          draft: { ...state.draft, step: "install" },
          trigger: action.trigger,
          direction: 1,
          error: "",
        };
      } catch (error) {
        return {
          ...state,
          error: error instanceof Error ? error.message : "Check your answers.",
        };
      }
    }
    case "synced":
      return action.id !== state.id
        ? state
        : {
            ...state,
            revision: action.revision,
            trigger: action.trigger,
            agent: state.agent && action.agent ? action.agent : state.agent,
          };
    case "error":
      return { ...state, error: action.message };
    case "notice":
      return { ...state, notice: action.message };
  }
}
export function snapshot(state: BuildState): Snapshot {
  return {
    id: state.id,
    revision: state.revision,
    trigger: state.trigger,
    draft: state.draft,
    agent: state.agent,
  };
}
