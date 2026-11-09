import { parseAgentSpec, uniqueTrigger, type AgentSpec } from "@agents/spec";
// Created agents live on this device. The workshop and the setup pages share this key.
export const LIBRARY_KEY = "agent-creations:library:v2";
export type SavedAgent = { id: string; spec: AgentSpec };
export function readLibrary(): SavedAgent[] {
  const saved = localStorage.getItem(LIBRARY_KEY);
  return saved
    ? JSON.parse(saved).map((item: SavedAgent) => ({ id: item.id, spec: parseAgentSpec(item.spec) }))
    : [];
}
/** Copies someone's agent into this device's library under a free trigger. */
export function addToLibrary(spec: AgentSpec): AgentSpec {
  const library = readLibrary();
  const trigger = uniqueTrigger(spec.name, library.map((item) => item.spec.trigger));
  const copy = parseAgentSpec({ ...spec, trigger, slug: trigger });
  localStorage.setItem(LIBRARY_KEY, JSON.stringify([...library, { id: crypto.randomUUID(), spec: copy }]));
  return copy;
}
