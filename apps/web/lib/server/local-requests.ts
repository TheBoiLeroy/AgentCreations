import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Development-only store: { "search term": count }. Not used when Supabase is configured.
export const localRequestsFile = () =>
  process.env.LOCAL_DATA_DIR ? join(process.env.LOCAL_DATA_DIR, "skill-requests.json") : join(process.cwd(), ".local", "skill-requests.json");

export async function saveLocalRequest(term: string): Promise<number> {
  const file = localRequestsFile();
  let counts: Record<string, number> = {};
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) counts = parsed;
  } catch {
    // Missing or unreadable file: start fresh.
  }
  if (!(term in counts) && Object.keys(counts).length >= 5000) throw new Error("Local request list is full.");
  counts[term] = (Number(counts[term]) || 0) + 1;
  await mkdir(join(file, ".."), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(counts, null, 2));
  await rename(temp, file);
  return counts[term];
}
