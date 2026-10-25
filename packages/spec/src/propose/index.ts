/** Milestone-one primitives. Not yet connected to persistence, compile or exports. */
export type * from "./model";
export {
  evaluateCondition,
  parseCondition,
  parseSpecPath,
  readSpecPath,
} from "./conditions";
export {
  outputTemplateSchema,
  parseOutputTemplate,
  templateProblems,
  templateToJsonSchema,
  type JsonSchema,
  type ShapeResolver,
  type TemplateValidationOptions,
} from "./templates";
export { applyEdit, applyEdits } from "./edits";
