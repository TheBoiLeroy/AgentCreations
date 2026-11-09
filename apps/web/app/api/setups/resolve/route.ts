import { z } from "zod";
import { catalog, getSkillSource } from "@agents/jev";
import { apiError, assertSameOrigin, readBody } from "../../../../lib/server/builds";
import { database } from "../../../../lib/server/store/db";
import { publishedSkillSources } from "../../../../lib/server/store/setups";
import { indexedSkills } from "../../../../lib/server/store/catalog";

const nameSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
interface Match {
  repository: string;
  skill: string;
  from: "catalog" | "setups" | "index";
  uses: number;
}
// Turns bare skill names from an import into repositories: the curated catalog, then skills
// other people published, then the synced skills.sh index. Nothing is sent to another service.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { names } = z.object({ names: z.array(nameSchema).min(1).max(100) }).strict().parse(await readBody(request));
    const wanted = [...new Set(names)];
    const db = await database();
    const found = new Map<string, Match[]>(wanted.map((name) => [name, []]));
    const add = (name: string, match: Match) => {
      const list = found.get(name);
      if (list && !list.some((m) => m.repository.toLowerCase() === match.repository.toLowerCase())) list.push(match);
    };
    for (const tool of catalog) {
      const source = getSkillSource(tool.id);
      if (source && found.has(source.skill)) add(source.skill, { ...source, from: "catalog", uses: 0 });
    }
    for (const row of await publishedSkillSources(db, wanted))
      add(row.name, { repository: row.repository, skill: row.name, from: "setups", uses: Number(row.uses) });
    for (const row of await indexedSkills(db, wanted))
      add(row.name, { repository: row.repository, skill: row.name, from: "index", uses: Number(row.installs) });
    return Response.json({ matches: Object.fromEntries([...found].map(([name, list]) => [name, list.slice(0, 5)])) });
  } catch (error) {
    return apiError(error);
  }
}
