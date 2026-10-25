// Contracts from docs/Agent Builder Propose-and-Correct Spec.md.
// These are not yet an import/export wire format; existing v3 adapters remain unchanged.
export type StageName =
  "describe" | "questions" | "preview" | "testDrive" | "lock";
export type SpecPath = string;
export type Category =
  | "finance"
  | "marketing"
  | "estimates"
  | "research"
  | "writing"
  | "monitoring"
  | "data-cleanup"
  | "scheduling"
  | "other";
export type InputKind =
  | "url"
  | "file"
  | "folder"
  | "text"
  | "number"
  | "date"
  | "choice"
  | "connection"
  | "upstream";
export type FileFormat =
  "csv" | "xlsx" | "pdf" | "docx" | "txt" | "md" | "json" | "image";
export type OutputKind =
  | "spreadsheet"
  | "document"
  | "action-plan"
  | "chat-message"
  | "data"
  | "live-panel";
export interface ShapeRef {
  id: string;
  version: number;
}
export interface InputGuess {
  name: string;
  label: string;
  kind: InputKind;
  formats?: FileFormat[];
  required: boolean;
  multiple: boolean;
}
export interface OutputGuess {
  kind: OutputKind;
  destination: "chat" | "file" | "widget" | "status" | "connection";
  shape?: ShapeRef;
}
export interface Intent {
  summary: string;
  category: Category;
  runtime: "worker" | "extension";
  runtimeReason: string;
  inputsGuess: InputGuess[];
  outputGuess: OutputGuess;
  sideEffects: "none" | "external";
  externalActions: string[];
  ambiguities: string[];
  confidence: number;
}
export interface Decision {
  at: string;
  stage: StageName;
  kind:
    | "skip-stage"
    | "override-runtime"
    | "confirm-intent"
    | "approve-preview"
    | "accept-rule"
    | "reject-rule"
    | "skip-test-drive"
    | "lock";
  detail?: string;
}
export type Condition =
  | { path: SpecPath; equals: unknown }
  | { path: SpecPath; includes: unknown }
  | { path: SpecPath; exists: boolean }
  | { descriptionMentions: string[] }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };
export interface Effect {
  path: SpecPath;
  op: "set" | "add" | "remove";
  value: unknown;
}
export type AnswerType =
  "single" | "multi" | "text" | "number" | "url" | "file-sample";
export interface QuestionOption {
  id: string;
  label: string;
  effects: Effect[];
}
export interface QuestionTemplate {
  id: string;
  category: Category | "*";
  text: string;
  help?: string;
  answer: AnswerType;
  options?: QuestionOption[];
  youDecide: QuestionOption["id"] | null;
  askIf?: Condition;
  skipIf?: Condition;
  priority: number;
  impact: "blocking" | "shapes-output" | "nice-to-have";
}
export interface Answer {
  kind:
    | "option"
    | "options"
    | "text"
    | "number"
    | "url"
    | "file-sample"
    | "you-decide"
    | "skipped";
  value?: unknown;
  answeredAt: string;
}
export interface AskedQuestion {
  id: string;
  source: "bank" | "generated";
  templateId?: string;
  text: string;
  answerType: AnswerType;
  options?: QuestionOption[];
  answer?: Answer;
  askedAt: string;
}
export interface Assumption {
  id: string;
  path: SpecPath;
  value: unknown;
  text: string;
  origin: "you-decide" | "category-default" | "skipped-question";
  questionId?: string;
}
export interface ColumnTemplate {
  id: string;
  name: string;
  type:
    | "text"
    | "number"
    | "currency"
    | "date"
    | "percent"
    | "choice"
    | "boolean"
    | "url";
  currency?: string;
  choices?: string[];
  formula?: string;
  required: boolean;
  description: string;
}
export interface SpreadsheetTemplate {
  kind: "spreadsheet";
  sheets: {
    id: string;
    name: string;
    purpose: string;
    columns: ColumnTemplate[];
    sortBy?: { column: string; dir: "asc" | "desc" };
    totals?: { column: string; fn: "sum" | "avg" | "count" | "min" | "max" }[];
    groupBy?: string;
    charts?: {
      kind: "bar" | "line" | "pie";
      x: string;
      y: string;
      title: string;
    }[];
  }[];
}
export interface SectionTemplate {
  id: string;
  heading: string;
  purpose: string;
  role?: string;
  contains: "prose" | "bullets" | "table" | "steps" | "checklist";
  columns?: ColumnTemplate[];
  minItems?: number;
  maxItems?: number;
  required: boolean;
}
export interface DocumentTemplate {
  kind: "document" | "action-plan";
  sections: SectionTemplate[];
}
export interface MessageTemplate {
  kind: "chat-message";
  sections: SectionTemplate[];
  maxWords?: number;
}
export interface PanelTemplate {
  kind: "live-panel";
  rowIs: string;
  columns: ColumnTemplate[];
  refreshSeconds: number;
}
export interface DataTemplate {
  kind: "data";
  shape: ShapeRef;
}
export type OutputTemplate =
  | SpreadsheetTemplate
  | DocumentTemplate
  | MessageTemplate
  | PanelTemplate
  | DataTemplate;
export interface TemplateEdit {
  at: string;
  by: "click" | "text";
  op:
    | "add"
    | "remove"
    | "rename"
    | "move"
    | "set-type"
    | "set-choices"
    | "set-formula"
    | "set-required"
    | "set-sort"
    | "set-total"
    | "set-group"
    | "add-chart"
    | "remove-chart";
  target: { sheet?: string; column?: string; section?: string; chart?: number };
  value?: unknown;
  userText?: string;
}
export interface Preview {
  revision: number;
  template: OutputTemplate;
  sample: unknown;
  edits: TemplateEdit[];
  approved: boolean;
  approvedRevision?: number;
}
export interface ValidationIssue {
  path: string;
  problem: string;
  severity: "error" | "warning";
}
export interface TraceStep {
  tool: string;
  summary: string;
  ms: number;
  ok: boolean;
}
export interface OutputLocator {
  sheet?: string;
  row?: number;
  column?: string;
  section?: string;
  item?: number;
}
export interface Correction {
  id: string;
  at: OutputLocator;
  kind: "wrong-value" | "missing" | "extra" | "wrong-format" | "general";
  before?: unknown;
  after?: unknown;
  note?: string;
}
export interface Rule {
  id: string;
  text: string;
  scope: "whole-output" | OutputLocator;
  fromCorrections: string[];
  status: "proposed" | "accepted" | "rejected" | "edited";
}
export interface TestInputRef {
  kind: "upload" | "url" | "text" | "connection";
  storageKey?: string;
  url?: string;
  text?: string;
  bytes?: number;
  detectedFormat?: FileFormat;
}
export interface TestRun {
  id: string;
  ranWith: { previewRevision: number; ruleIds: string[]; specHash: string };
  inputs: Record<string, TestInputRef>;
  status: "running" | "succeeded" | "failed" | "cancelled" | "timed-out";
  output?: unknown;
  conformance: ValidationIssue[];
  trace: TraceStep[];
  corrections: Correction[];
  costUsd?: number;
  startedAt: string;
  endedAt?: string;
  error?: string;
}
export type ProvenanceSource =
  | "description"
  | "question"
  | "you-decide"
  | "category-default"
  | "preview-edit"
  | "test-correction"
  | "registry"
  | "compiler";
export interface PortSpec {
  id: string;
  label: string;
  kind: InputKind;
  shape: ShapeRef;
  formats?: FileFormat[];
  required: boolean;
  multiple: boolean;
}
export interface AgentSpecV3 {
  schemaVersion: 3;
  id: string;
  version: string;
  name: string;
  slug: string;
  summary: string;
  whenToUse: string;
  category: Category;
  runtime: "worker" | "extension";
  conversation: "oneShot" | "followUp";
  inputs: PortSpec[];
  outputs: PortSpec[];
  outputTemplate: OutputTemplate;
  method: string[];
  rules: string[];
  assumptions: string[];
  tools: string[];
  dataSources: string[];
  sideEffects: "none" | "external";
  approvals: { before: string; shows: string }[];
  limits: { timeoutSec: number; maxOutputBytes: number };
  provenance: Record<SpecPath, { source: ProvenanceSource; ref?: string }>;
  builtFrom: { draftId: string; draftRevision: number };
  tested: "real" | "simulated" | "skipped";
}
export interface Draft {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  stage: StageName | "locked";
  revision: number;
  description: string;
  intent?: Intent;
  questions: AskedQuestion[];
  assumptions: Assumption[];
  preview?: Preview;
  testRuns: TestRun[];
  rules: Rule[];
  decisions: Decision[];
  working: Partial<AgentSpecV3>;
  stale: StageName[];
  lockedSpecId?: string;
}
export interface Shape {
  id: string;
  version: number;
  strictness: "loose" | "observed" | "strict";
  jsonSchema: object;
  extends?: ShapeRef;
  examples: unknown[];
  owner: "library" | string;
}
export interface PipelineNode {
  id: string;
  brick: {
    kind: "agent" | "tool" | "human" | "adapter";
    ref: string;
    version: string;
  };
  connection?: string;
  position: { x: number; y: number };
  config?: Record<string, unknown>;
}
export type EdgeStatus =
  | "unchecked"
  | "compatible"
  | "needs-adapter"
  | "needs-answer"
  | "incompatible"
  | "verified";
export interface CompatIssue {
  field: string;
  problem:
    "missing" | "type-mismatch" | "cardinality" | "format" | "unit" | "enum";
  detail: string;
  fix?: "adapter" | "question" | "change-upstream" | "user-input" | "none";
}
export interface Edge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
  status: EdgeStatus;
  issues: CompatIssue[];
  adapterNodeId?: string;
  verifiedRuns: number;
}
export interface Pipeline {
  id: string;
  ownerId: string;
  name: string;
  version: number;
  nodes: PipelineNode[];
  edges: Edge[];
}
export interface PipelineRun {
  id: string;
  pipelineId: string;
  pipelineVersion: number;
  status:
    "running" | "paused-for-approval" | "succeeded" | "failed" | "cancelled";
  nodeRuns: {
    nodeId: string;
    attempt: number;
    status:
      | "pending"
      | "running"
      | "waiting-approval"
      | "succeeded"
      | "failed"
      | "skipped";
    input?: unknown;
    output?: unknown;
    validation: ValidationIssue[];
    startedAt?: string;
    endedAt?: string;
  }[];
}
