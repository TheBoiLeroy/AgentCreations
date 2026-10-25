import { z } from "zod";

// Remote metadata is untrusted data. Never execute or install fetched content.
const token = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const catalogEntrySchema = z
  .object({
    id: z.string().min(3).max(500),
    slug: token,
    name: z.string().min(1).max(500),
    source: z.string().min(1).max(330),
    installs: z.number().int().nonnegative(),
    sourceType: z.enum(["github", "well-known"]),
    installUrl: z.string().url().max(1000).nullable(),
    url: z.string().url().max(1000),
    isDuplicate: z.boolean().optional(),
  })
  .superRefine((entry, ctx) => {
    const sourceValid =
      entry.sourceType === "github"
        ? /^[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(
            entry.source,
          )
        : /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(entry.source);
    if (!sourceValid || entry.id !== `${entry.source}/${entry.slug}`)
      ctx.addIssue({ code: "custom", message: "Invalid source identity" });
    const expected = `https://skills.sh/${entry.id}`;
    if (
      entry.url !== expected &&
      entry.url !== expected.replace("skills.sh", "www.skills.sh")
    )
      ctx.addIssue({ code: "custom", message: "Invalid listing URL" });
    if (entry.installUrl) {
      const url = new URL(entry.installUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (entry.sourceType === "github"
          ? entry.installUrl !== `https://github.com/${entry.source}`
          : url.hostname !== entry.source)
      )
        ctx.addIssue({ code: "custom", message: "Invalid installation URL" });
    }
  });
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
const pageSchema = z.object({
  data: z.array(catalogEntrySchema).min(1).max(500),
  pagination: z.object({
    page: z.number().int().nonnegative(),
    perPage: z.literal(500),
    total: z.number().int().min(1).max(100000),
    hasMore: z.boolean(),
  }),
});
export class CatalogSourceError extends Error {
  constructor(
    public status: number,
    public retryAfter: number | null = null,
  ) {
    super("Catalog source unavailable; the published catalog has not changed.");
  }
}
export async function fetchCatalogPage(
  page: number,
  oidcToken: string,
  fetcher: typeof fetch = fetch,
) {
  if (!Number.isInteger(page) || page < 0 || page >= 200 || !oidcToken)
    throw new Error("Invalid catalog sync configuration");
  const response = await fetcher(
    `https://skills.sh/api/v1/skills?view=all-time&page=${page}&per_page=500`,
    {
      headers: { Authorization: `Bearer ${oidcToken}` },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const retry = Number(response.headers.get("retry-after"));
    throw new CatalogSourceError(
      response.status,
      retry > 0 && Number.isFinite(retry) ? Math.ceil(retry) : null,
    );
  }
  // Bound the actual streamed bytes, not just a potentially absent Content-Length.
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing catalog response");
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2000000) {
        await reader.cancel();
        throw new Error("Catalog page exceeds size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const result = pageSchema.parse(JSON.parse(text));
  const { pagination, data } = result;
  const count = page * 500 + data.length;
  if (
    pagination.page !== page ||
    new Set(data.map((e) => e.id)).size !== data.length ||
    (pagination.hasMore
      ? data.length !== 500 || count >= pagination.total
      : count !== pagination.total)
  )
    throw new Error("Incomplete or inconsistent catalog page");
  return result;
}

export const curationSchema = z
  .object({
    target: z
      .string()
      .min(3)
      .max(500)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/),
    decision: z.enum(["approved-source", "excluded", "flagged", "unreviewed"]),
    reason: z.string().trim().min(1).max(2000),
    requirements: z
      .object({
        fileRead: z.boolean().optional(),
        fileWrite: z.boolean().optional(),
        shell: z.boolean().optional(),
        browser: z.boolean().optional(),
        network: z.boolean().optional(),
        credentials: z.boolean().optional(),
        verified: z.boolean().optional(),
      })
      .strict(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
