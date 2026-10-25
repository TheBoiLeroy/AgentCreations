// Bundled `extract_document` tool for extract-documents. Dependency-free, read-only text
// extraction for PDF, DOCX, XLSX and PPTX. Scanned PDFs and unusual encodings return no text.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { Type } from 'typebox';

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY = 50 * 1024 * 1024;

/** Reads stored and deflated entries from a ZIP archive (Office Open XML container). */
export function unzip(data: Buffer, wanted: (name: string) => boolean): Map<string, string> {
  const files = new Map<string, string>();
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--)
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('Not a valid Office document (ZIP directory missing).');
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt ZIP directory.');
    const method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    const name = data.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name) || size > MAX_ENTRY) continue;
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + compressed);
    if (method === 0) files.set(name, raw.toString('utf8'));
    else if (method === 8) files.set(name, inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }).toString('utf8'));
  }
  return files;
}

const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
const byNumber = (a: string, b: string) => Number(a.match(/(\d+)\.xml$/)?.[1] || 0) - Number(b.match(/(\d+)\.xml$/)?.[1] || 0);

function docx(data: Buffer) {
  const xml = unzip(data, (name) => name === 'word/document.xml').get('word/document.xml') || '';
  return decode(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>|<\/w:p>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g, ''),
  ).trim();
}

function columnIndex(reference: string) {
  let index = 0;
  for (const char of reference.replace(/\d+/g, '')) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}
function xlsx(data: Buffer) {
  const files = unzip(data, (name) => name === 'xl/sharedStrings.xml' || name === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const shared = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  const names = [...(files.get('xl/workbook.xml') || '').matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decode(m[1]));
  const sheets = [...files.keys()].filter((name) => name.startsWith('xl/worksheets/')).sort(byNumber);
  return sheets
    .map((name, index) => {
      const rows = [...files.get(name)!.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
        const cells: string[] = [];
        for (const cell of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attributes = cell[1];
          const body = cell[2] || '';
          const reference = attributes.match(/r="([A-Z]+\d+)"/)?.[1];
          const type = attributes.match(/t="(\w+)"/)?.[1];
          const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
          const text =
            type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr' ? decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')) : decode(value);
          cells[reference ? columnIndex(reference) : cells.length] = /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        }
        return Array.from(cells, (cell) => cell ?? '').join(',');
      });
      return '# Sheet: ' + (names[index] || name) + '\n' + rows.join('\n');
    })
    .join('\n\n')
    .trim();
}

function pptx(data: Buffer) {
  const files = unzip(data, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  return [...files.keys()]
    .sort(byNumber)
    .map((name, index) => '# Slide ' + (index + 1) + '\n' + [...files.get(name)!.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1])).join('\n'))
    .join('\n\n')
    .trim();
}

function pdfString(raw: string) {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, code: string) =>
    /^[0-7]/.test(code) ? String.fromCharCode(parseInt(code, 8)) : ({ n: '\n', r: '', t: '\t', b: '', f: '' } as Record<string, string>)[code] ?? code,
  );
}
/** Best-effort text from content streams (Tj, TJ, ' and " operators). */
export function pdf(data: Buffer) {
  const binary = data.toString('latin1');
  const chunks: string[] = [];
  for (const match of binary.matchAll(/<<([\s\S]*?)>>\s*stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const end = binary.indexOf('endstream', start);
    if (end < 0) continue;
    const raw = data.subarray(start, end);
    let content: string;
    try {
      content = /FlateDecode/.test(match[1]) ? inflateSync(raw, { maxOutputLength: MAX_ENTRY }).toString('latin1') : /\/Filter/.test(match[1]) ? '' : raw.toString('latin1');
    } catch {
      continue;
    }
    for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
      let line = '';
      for (const op of block[1].matchAll(/\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|(T\*|Td|TD|Tm)/g)) {
        if (op[3]) {
          if (line.trim()) chunks.push(line);
          line = '';
        } else if (op[2] !== undefined) line += pdfString(op[2]);
        else
          for (const part of op[1].matchAll(/\(((?:\\.|[^\\)])*)\)|(-?\d+(?:\.\d+)?)/g))
            if (part[1] !== undefined) line += pdfString(part[1]);
            else if (Number(part[2]) < -200) line += ' ';
      }
      if (line.trim()) chunks.push(line);
    }
  }
  return chunks.join('\n').trim();
}

export function extractText(path: string): string {
  const format = extname(path).slice(1).toLowerCase();
  if (statSync(path).size > MAX_BYTES) throw new Error('File is larger than 25 MB.');
  const data = readFileSync(path);
  const text = format === 'pdf' ? pdf(data) : format === 'docx' ? docx(data) : format === 'xlsx' ? xlsx(data) : format === 'pptx' ? pptx(data) : undefined;
  if (text === undefined) throw new Error('Unsupported format: ' + (format || 'none') + '. Use read for text files.');
  if (!text) throw new Error('No extractable text. The file may be scanned or use an unsupported encoding; ask for a text or CSV export.');
  return text;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'extract_document',
    label: 'Extract document',
    description: 'Extract plain text from a PDF, DOCX, XLSX (as CSV per sheet) or PPTX file. Read-only.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, relative to the working directory' }),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Character offset for long documents' })),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const text = extractText(resolve(ctx.cwd, params.path));
      const offset = params.offset ?? 0;
      const page = text.slice(offset, offset + 50000);
      const more = offset + page.length < text.length ? '\n\n[Truncated. Continue with offset ' + (offset + page.length) + ' of ' + text.length + '.]' : '';
      return { content: [{ type: 'text', text: page + more }], details: undefined };
    },
  });
}
