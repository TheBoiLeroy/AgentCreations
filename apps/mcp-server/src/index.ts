import Anthropic from "@anthropic-ai/sdk";
import { resolve } from "node:path";
import { agentPrompt } from "@agents/spec";
import { createApp } from "./server.js";

if (!process.env.ANTHROPIC_API_KEY)
  throw new Error("Set ANTHROPIC_API_KEY on the server.");
if (!process.env.ANTHROPIC_MODEL)
  throw new Error("Set ANTHROPIC_MODEL to an available model ID.");
const client = new Anthropic({ maxRetries: 0, timeout: 90000 });
const app = createApp({
  token: process.env.MCP_AUTH_TOKEN || "",
  agentsDirectory: resolve(process.env.AGENTS_DIRECTORY || "agents"),
  allowedHosts: (process.env.MCP_ALLOWED_HOSTS || "localhost,127.0.0.1")
    .split(",")
    .map((s) => s.trim()),
  run: async (spec, task, signal) => {
    const result = await client.messages.create(
      {
        model: process.env.ANTHROPIC_MODEL!,
        max_tokens: 4096,
        system: `${agentPrompt(spec)}\nRuntime: text-only. You have no tools, file access, web access, or app connections. Ask for missing data. Return results in the conversation; never claim external side effects.`,
        messages: [{ role: "user", content: task }],
      },
      { signal },
    );
    return result.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
  },
});
const server = app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "127.0.0.1",
  () => console.log("MCP server ready"),
);
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
