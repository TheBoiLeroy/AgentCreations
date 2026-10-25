import express from "express";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  parseAgentSpec,
  triggerSchema,
  agentPrompt,
  type AgentSpec,
} from "@agents/spec";

export interface ServerOptions {
  token: string;
  agentsDirectory: string;
  allowedHosts: string[];
  run: (spec: AgentSpec, task: string, signal: AbortSignal) => Promise<string>;
}
function authorized(value: string | undefined, token: string) {
  const supplied = Buffer.from(value || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
export function createApp(options: ServerOptions) {
  if (options.token.length < 32)
    throw new Error("MCP_AUTH_TOKEN must contain at least 32 characters.");
  if (!options.allowedHosts.length)
    throw new Error("At least one allowed host is required.");
  const app = express();
  app.disable("x-powered-by");
  let active = 0;
  // Bounded process-wide rate limit: this is a single-owner server, not a multitenant API.
  let windowStart = Date.now(),
    requests = 0;
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use(
    "/agents",
    (req, res, next) => {
      if (!options.allowedHosts.includes(req.hostname) || req.headers.origin) {
        res.status(403).json({ error: "Host or origin not allowed" });
        return;
      }
      if (!authorized(req.headers.authorization, options.token)) {
        res.status(401).json({ error: "Bearer token required" });
        return;
      }
      if (Date.now() - windowStart > 60000) {
        windowStart = Date.now();
        requests = 0;
      }
      if (++requests > 60) {
        res
          .set("Retry-After", "60")
          .status(429)
          .json({ error: "Rate limit exceeded" });
        return;
      }
      next();
    },
    express.json({ limit: "64kb" }),
  );
  app.post("/agents/:slug/mcp", async (req, res) => {
    const slug = triggerSchema.safeParse(req.params.slug);
    if (!slug.success) {
      res.status(400).json({ error: "Invalid agent name" });
      return;
    }
    let spec: AgentSpec;
    try {
      const raw = await readFile(
        resolve(options.agentsDirectory, `${slug.data}.json`),
        "utf8",
      );
      if (raw.length > 100000) throw new Error("Agent too large");
      spec = parseAgentSpec(JSON.parse(raw));
      if (spec.slug !== slug.data) throw new Error("Agent filename mismatch");
    } catch {
      res.status(404).json({ error: "Agent not found or invalid" });
      return;
    }
    const server = new McpServer({
      name: `agent-${spec.slug}`,
      version: "1.0.0",
    });
    server.registerTool(
      spec.slug,
      {
        title: spec.name,
        description: `${spec.description} Text-only execution; supply file contents in the task. No web, filesystem or app connections.`,
        inputSchema: { task: z.string().trim().min(1).max(30000) },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async ({ task }, extra) => {
        if (active >= 3)
          return {
            isError: true,
            content: [
              { type: "text", text: "Server is busy. Try again shortly." },
            ],
          };
        active++;
        try {
          const signal = AbortSignal.any([
            extra.signal,
            AbortSignal.timeout(90000),
          ]);
          const text = await options.run(spec, task, signal);
          return { content: [{ type: "text", text }] };
        } catch {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Agent execution failed or timed out. Check server credentials and model configuration.",
              },
            ],
          };
        } finally {
          active--;
        }
      },
    );
    server.registerResource(
      "instructions",
      `agent:///${spec.slug}/instructions`,
      { mimeType: "text/markdown" },
      async (uri) => ({
        contents: [
          { uri: uri.href, mimeType: "text/markdown", text: agentPrompt(spec) },
        ],
      }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({ error: "MCP request failed" });
    }
  });
  app.all("/agents/:slug/mcp", (_req, res) => {
    res
      .set("Allow", "POST")
      .status(405)
      .json({ error: "Stateless MCP supports POST only" });
  });
  return app;
}
