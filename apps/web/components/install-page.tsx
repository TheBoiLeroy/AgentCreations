"use client";
import { useState } from "react";
import { Check, Copy, Download, Braces, ShieldCheck } from "lucide-react";
import type { AgentSpec } from "@agents/spec";
import {
  archive,
  exportProblems,
  installation,
  piPackage,
  skillFiles,
  tools,
  type Target,
} from "@agents/exporters";
import { PageHeading, ProblemList } from "./build-pages";
export function download(
  name: string,
  data: string | Uint8Array,
  type: string,
) {
  const blob = new Blob(
    [typeof data === "string" ? data : new Uint8Array(data)],
    { type },
  );
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function InstallPage({
  agent,
  notify,
  onEdit,
}: {
  agent: AgentSpec;
  notify: (message: string) => void;
  onEdit: () => void;
}) {
  const [target, setTarget] = useState<Target>("Pi"),
    [endpoint, setEndpoint] = useState("");
  let instructions = { snippet: "", note: "", example: "" },
    error = "";
  try {
    instructions = installation(agent, target, endpoint);
  } catch (err) {
    error = err instanceof Error ? err.message : "Invalid endpoint";
  }
  const problems = exportProblems(agent, target);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify("Copied to clipboard.");
    } catch {
      notify("Clipboard unavailable. Select and copy the text manually.");
    }
  };
  const exportFiles = () => {
    const pi = target === "Pi";
    if (problems.length) return;
    download(
      `${agent.slug}-${pi ? "pi" : "skill"}.zip`,
      archive(
        pi ? piPackage(agent) : skillFiles(agent),
        pi ? `${agent.slug}-pi` : undefined,
      ),
      "application/zip",
    );
    notify("Download ready. Review the files before installing.");
  };
  return (
    <>
      <PageHeading
        eyebrow="MADE BY YOU. READY TO GO."
        title="Where do you want to use it?"
      >
        {agent.name} is ready. Bring it to the tools you already use.
      </PageHeading>
      <div className="tool-chips" role="group" aria-label="Choose your tool">
        {tools.map((tool) => (
          <button
            key={tool}
            aria-pressed={target === tool}
            className={target === tool ? "selected" : ""}
            onClick={() => setTarget(tool)}
          >
            {tool}
            {target === tool && <Check size={14} />}
          </button>
        ))}
      </div>
      {["Claude app", "ChatGPT", "Cursor"].includes(target) && (
        <label>
          Your deployed MCP server URL
          <input
            type="url"
            value={endpoint}
            placeholder="https://agents.example.com"
            onChange={(e) => setEndpoint(e.target.value)}
          />
          <span className="hint">
            Deployment is separate. Creating an agent does not provision a
            server or connect accounts.
          </span>
        </label>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ProblemList
        title={`Export stopped: fix these for ${target}`}
        problems={problems}
      />
      {problems.length > 0 && (
        <button className="text-button" onClick={onEdit}>
          Edit the details
        </button>
      )}
      <div className="install-card">
        <div className="code-label">
          <span>INSTALL / CONNECT</span>
          <button
            disabled={!instructions.snippet}
            onClick={() => void copy(instructions.snippet)}
          >
            <Copy size={14} /> Copy
          </button>
        </div>
        <pre>{instructions.snippet}</pre>
      </div>
      <p className="install-note hint">{instructions.note}</p>
      <div className="actions">
        <button
          className="button primary"
          onClick={exportFiles}
          disabled={problems.length > 0}
        >
          <Download size={16} /> Download{" "}
          {target === "Pi" ? "Pi package" : "skill"}
        </button>
        <button
          className="button"
          onClick={() =>
            download(
              `${agent.slug}.json`,
              JSON.stringify(agent, null, 2),
              "application/json",
            )
          }
        >
          <Braces size={16} /> Agent JSON
        </button>
      </div>
      <div className="test-prompt">
        <span className="eyebrow">GIVE IT A FIRST TASK</span>
        <p>{instructions.example}</p>
        <button
          className="text-button"
          disabled={!instructions.example}
          onClick={() => void copy(instructions.example)}
        >
          Copy example <Copy size={14} />
        </button>
      </div>
      <p className="safety">
        <ShieldCheck size={18} />{" "}
        {agent.runtime === "worker"
          ? "Pi workers are read-only and only get the tools listed in the package; tools the exporter can’t supply stop the export. Skills for other tools describe requirements, not granted access."
          : "The Pi extension reads only its listed data sources and makes no model calls."}{" "}
        Re-export and reinstall to update a local agent.
      </p>
    </>
  );
}
