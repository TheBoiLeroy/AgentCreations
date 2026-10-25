// Bundled `calc` tool for analyze-data. A small arithmetic parser: no eval, no I/O.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const FUNCTIONS: Record<string, (...values: number[]) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  sqrt: Math.sqrt,
  round: (value, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits,
  min: Math.min,
  max: Math.max,
  sum: (...values) => values.reduce((total, value) => total + value, 0),
  avg: (...values) => values.reduce((total, value) => total + value, 0) / values.length,
  median: (...values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  },
};

/** Evaluates + - * / % ^, parentheses, percentages (12%) and the functions above. */
export function evaluate(expression: string): number {
  if (expression.length > 2000) throw new Error('Expression is too long.');
  const tokens = expression.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[a-z]+|\*\*|[-+*/%^(),]|\S/gi) || [];
  let position = 0;
  const peek = () => tokens[position];
  const take = (expected?: string) => {
    const token = tokens[position++];
    if (expected && token !== expected) throw new Error('Expected ' + expected + (token ? ' but found ' + token : ''));
    return token;
  };
  const primary = (): number => {
    const token = take();
    if (token === undefined) throw new Error('Unexpected end of expression.');
    if (token === '(') {
      const value = sum();
      take(')');
      return value;
    }
    if (token === '-') return -power();
    if (token === '+') return power();
    if (/^\d/.test(token)) {
      const value = Number(token);
      if (peek() === '%' && !/^[\d(a-z]/i.test(tokens[position + 1] || '')) {
        position++;
        return value / 100;
      }
      return value;
    }
    const fn = FUNCTIONS[token.toLowerCase()];
    if (fn) {
      take('(');
      const args = [sum()];
      while (peek() === ',') {
        take(',');
        args.push(sum());
      }
      take(')');
      return fn(...args);
    }
    throw new Error('Unknown token: ' + token);
  };
  const power = (): number => {
    const base = primary();
    if (peek() === '^' || peek() === '**') {
      take();
      return base ** power();
    }
    return base;
  };
  const product = (): number => {
    let value = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const operator = take();
      const right = power();
      if (operator === '*') value *= right;
      else if (right === 0) throw new Error('Division by zero.');
      else value = operator === '/' ? value / right : value % right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek() === '+' || peek() === '-') value = take() === '+' ? value + product() : value - product();
    return value;
  };
  const result = sum();
  if (position < tokens.length) throw new Error('Unexpected token: ' + tokens[position]);
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number.');
  return result;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'calc',
    label: 'Calculate',
    description:
      'Evaluate arithmetic exactly. Supports + - * / % ^, parentheses, percentages (no thousands separators) and abs, ceil, floor, sqrt, round(x, digits), min, max, sum, avg, median. Use it for every number you report.',
    parameters: Type.Object({
      expressions: Type.Array(Type.String({ maxLength: 2000 }), { minItems: 1, maxItems: 50 }),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_id, params) {
      const results = params.expressions.map((expression) => {
        try {
          return { expression, value: evaluate(expression) };
        } catch (error) {
          return { expression, error: (error as Error).message };
        }
      });
      const text = results.map((r) => r.expression + ' = ' + ('value' in r ? String(r.value) : 'error: ' + r.error)).join('\n');
      return { content: [{ type: 'text', text }], details: undefined };
    },
  });
}
