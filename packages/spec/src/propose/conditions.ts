import type { Condition } from "./model";

const forbidden = new Set(["__proto__", "prototype", "constructor"]);

/** Deliberately not JavaScript: only dotted names and non-negative array indexes. */
export function parseSpecPath(path: string): string[] {
  if (
    path.length > 500 ||
    !/^[A-Za-z_][\w-]*(?:(?:\.[A-Za-z_][\w-]*)|(?:\[(?:0|[1-9]\d*)\]))*$/.test(
      path,
    )
  ) {
    throw new Error(`Invalid spec path: ${path}`);
  }
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  if (parts.some((part) => forbidden.has(part)))
    throw new Error("Unsafe spec path");
  return parts;
}

export function readSpecPath(root: unknown, path: string): unknown {
  let value = root;
  for (const part of parseSpecPath(path)) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, part)
    )
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function jsonValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value))
    return value.every((item) => jsonValue(item, depth + 1));
  return (
    record(value) &&
    Object.entries(value).every(
      ([key, item]) => !forbidden.has(key) && jsonValue(item, depth + 1),
    )
  );
}

/** Validate the whole tree before evaluating; malformed short-circuited branches still fail. */
export function parseCondition(input: unknown): Condition {
  let nodes = 0;
  function visit(value: unknown, depth: number): Condition {
    if (++nodes > 256 || depth > 32)
      throw new Error("Condition is too complex");
    if (!record(value)) throw new Error("Condition must be an object");
    const keys = Object.keys(value);
    if (keys.length === 1) {
      if (Object.hasOwn(value, "all") || Object.hasOwn(value, "any")) {
        const op = Object.hasOwn(value, "all") ? "all" : "any";
        const children = value[op];
        if (!Array.isArray(children))
          throw new Error("Condition group must be an array");
        const parsed = children.map((child) => visit(child, depth + 1));
        return op === "all" ? { all: parsed } : { any: parsed };
      }
      if (Object.hasOwn(value, "not"))
        return { not: visit(value.not, depth + 1) };
      if (Object.hasOwn(value, "descriptionMentions")) {
        const words = value.descriptionMentions;
        if (
          !Array.isArray(words) ||
          words.length > 100 ||
          !words.every(
            (word) =>
              typeof word === "string" &&
              word.trim().length > 0 &&
              word.length <= 200,
          )
        ) {
          throw new Error("descriptionMentions must contain non-empty phrases");
        }
        return { descriptionMentions: words };
      }
    }
    if (
      keys.length === 2 &&
      Object.hasOwn(value, "path") &&
      typeof value.path === "string"
    ) {
      parseSpecPath(value.path);
      if (Object.hasOwn(value, "exists") && typeof value.exists === "boolean")
        return { path: value.path, exists: value.exists };
      if (Object.hasOwn(value, "equals") && jsonValue(value.equals))
        return { path: value.path, equals: value.equals };
      if (Object.hasOwn(value, "includes") && jsonValue(value.includes))
        return { path: value.path, includes: value.includes };
    }
    throw new Error("Malformed condition");
  }
  return visit(input, 0);
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => equal(value, b[index]))
    );
  if (record(a) && record(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return false;
}

export function evaluateCondition(input: unknown, draft: unknown): boolean {
  const condition = parseCondition(input);
  function evaluate(node: Condition): boolean {
    if ("all" in node) return node.all.every(evaluate);
    if ("any" in node) return node.any.some(evaluate);
    if ("not" in node) return !evaluate(node.not);
    if ("descriptionMentions" in node) {
      const description = readSpecPath(draft, "description");
      if (typeof description !== "string") return false;
      // SPEC-GAP: matching boundaries are unspecified; use whole phrases to avoid
      // matching "rate" in "corporate", consistent with the existing Jev rules.
      return node.descriptionMentions.some((phrase) => {
        const escaped = phrase
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\s+/g, "\\s+");
        return new RegExp(
          `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
          "iu",
        ).test(description);
      });
    }
    const value = readSpecPath(draft, node.path);
    if ("exists" in node)
      return (value !== undefined && value !== null) === node.exists;
    if ("equals" in node) return equal(value, node.equals);
    return Array.isArray(value)
      ? value.some((item) => equal(item, node.includes))
      : typeof value === "string" &&
          typeof node.includes === "string" &&
          value.includes(node.includes);
  }
  return evaluate(condition);
}
