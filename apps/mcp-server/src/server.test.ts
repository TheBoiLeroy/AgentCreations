import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exampleAgent } from "@agents/spec";
import { createApp } from "./server";

const token = "test-token-with-at-least-32-characters";
let directory: string, server: Server, base: string;
const run = vi.fn(async () => "Prioritized leads");
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "agents-test-"));
  await writeFile(
    join(directory, "lead-sorter.json"),
    JSON.stringify(exampleAgent),
  );
  run.mockReset();
  run.mockResolvedValue("Prioritized leads");
  server = createApp({
    token,
    agentsDirectory: directory,
    allowedHosts: ["127.0.0.1"],
    run,
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  base = `http://127.0.0.1:${address.port}/agents/lead-sorter/mcp`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true });
});
async function connect() {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
describe("hosted MCP", () => {
  it("rejects missing authentication and browser origins", async () => {
    expect((await fetch(base, { method: "POST" })).status).toBe(401);
    expect(
      (
        await fetch(base, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: "https://evil.example",
          },
        })
      ).status,
    ).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
  it("supports real MCP initialization, discovery and calls", async () => {
    const client = await connect();
    try {
      const tools = await client.listTools();
      expect(tools.tools[0].name).toBe("lead-sorter");
      const result = await client.callTool({
        name: "lead-sorter",
        arguments: { task: "Review these leads" },
      });
      expect(result.content).toEqual([
        { type: "text", text: "Prioritized leads" },
      ]);
      expect(run.mock.calls).toHaveLength(1);
      const resources = await client.listResources();
      expect(resources.resources[0].uri).toBe(
        "agent:///lead-sorter/instructions",
      );
    } finally {
      await client.close();
    }
  });
  it("rejects invalid tasks before invoking the model", async () => {
    const client = await connect();
    try {
      const result = await client.callTool({
        name: "lead-sorter",
        arguments: { task: "" },
      });
      expect(result.isError).toBe(true);
      expect(run).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
  it("loads edited specs on the next request", async () => {
    const client = await connect();
    try {
      await writeFile(
        join(directory, "lead-sorter.json"),
        JSON.stringify({
          ...exampleAgent,
          description: "Updated agent instructions",
        }),
      );
      const tools = await client.listTools();
      expect(tools.tools[0].description).toContain(
        "Updated agent instructions",
      );
    } finally {
      await client.close();
    }
  });
  it("returns sanitized provider failures", async () => {
    run.mockRejectedValue(new Error("secret-key-should-not-leak"));
    const client = await connect();
    try {
      const result = await client.callTool({
        name: "lead-sorter",
        arguments: { task: "Run" },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret-key");
    } finally {
      await client.close();
    }
  });
  it("fails closed for unknown or malformed specs", async () => {
    await writeFile(join(directory, "lead-sorter.json"), "{}");
    const res = await fetch(base, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });
});
