import { documentFormats, textFormats } from "@agents/spec";

/**
 * Every tool id in a spec must resolve here before a Pi package is emitted.
 * - grant: becomes worker flags (and bundled tool files)
 * - behavior: needs nothing extra; described by the method instead
 * - live: wired by the extension template
 */
export type RegistryEntry =
  | {
      kind: "grant";
      piTools: string[];
      bundle?: { path: string; source: "calc" | "extract" };
      formats?: readonly string[];
      instruction: string;
    }
  | { kind: "behavior" }
  | { kind: "live" };

export const toolRegistry: Record<string, RegistryEntry> = {
  "read-files": {
    kind: "grant",
    piTools: ["read", "grep", "find", "ls"],
    formats: textFormats,
    instruction:
      "read, grep, find, ls: read, search and list files in the working directory. read handles text files and images only.",
  },
  "analyze-data": {
    kind: "grant",
    piTools: ["calc"],
    bundle: { path: "tools/calc.ts", source: "calc" },
    instruction:
      "calc: evaluate arithmetic exactly. Use it for every total, rate, adjustment and range you report; never do arithmetic in your head.",
  },
  "extract-documents": {
    kind: "grant",
    piTools: ["extract_document"],
    bundle: { path: "tools/extract.ts", source: "extract" },
    formats: documentFormats,
    instruction:
      "extract_document: get plain text from PDF, DOCX, XLSX (CSV per sheet) and PPTX files. Use it instead of read for those formats.",
  },
  "draft-text": { kind: "behavior" },
  "plan-tasks": { kind: "behavior" },
  "review-content": { kind: "behavior" },
  "session-events": { kind: "live" },
  "process-list": { kind: "live" },
};
export const behaviorTools = Object.entries(toolRegistry)
  .filter(([, entry]) => entry.kind === "behavior")
  .map(([id]) => id);

export interface WorkerConfig {
  tools: string[];
  extensions: string[];
}
/** Merges registry grants into one flag set. Unknown ids are skipped here and reported by checks. */
export function workerConfig(toolIds: string[]): WorkerConfig {
  const tools = new Set<string>(),
    extensions = new Set<string>();
  for (const id of toolIds) {
    const entry = toolRegistry[id];
    if (entry?.kind !== "grant") continue;
    entry.piTools.forEach((tool) => tools.add(tool));
    if (entry.bundle) extensions.add(entry.bundle.path);
  }
  return { tools: [...tools], extensions: [...extensions] };
}
export function readableFormats(toolIds: string[]): Set<string> {
  return new Set(
    toolIds.flatMap((id) => {
      const entry = toolRegistry[id];
      return entry?.kind === "grant" ? [...(entry.formats || [])] : [];
    }),
  );
}
