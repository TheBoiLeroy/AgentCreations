"use client";
import { useEffect, useState } from "react";
import { coverageReportSchema, type CoverageReport } from "@agents/jev";
import { requirementText } from "@agents/spec";
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
/** The model's check of the finished agent against the confirmed requirements. */
function CompletenessCheck({ agent, onEdit }: { agent: AgentSpec; onEdit: () => void }) {
  const [report, setReport] = useState<CoverageReport>();
  const requirements = agent.requirements || [];
  useEffect(() => {
    if (!requirements.length) return;
    let active = true;
    setReport(undefined);
    fetch("/api/jev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verify: agent }),
      signal: AbortSignal.timeout(30000),
    })
      .then(async (response) => coverageReportSchema.parse(await response.json()))
      .catch((): CoverageReport => ({ status: "unavailable", reason: "The model check couldn’t be reached. The automated checks still passed." }))
      .then((result) => active && setReport(result));
    return () => {
      active = false;
    };
    // One check per created agent.
  }, [agent]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!requirements.length) return null;
  const missing = report?.status === "checked" ? report.results.filter((r) => !r.covered) : [];
  return (
    <section className="details-section" aria-label="Completeness check">
      <h3>Does it do what you asked?</h3>
      {!report && <p className="hint">Checking the agent against your {requirements.length} requirements…</p>}
      {report?.status === "unavailable" && <p className="hint">Second check not run. {report.reason}</p>}
      {report?.status === "checked" && !missing.length && (
        <p className="hint">
          <Check size={13} /> A second check found all {requirements.length} requirements in the agent.
        </p>
      )}
      {missing.length > 0 && (
        <>
          <ul className="question-list">
            {missing.map((result) => {
              const requirement = requirements.find((r) => r.id === result.requirement_id);
              return (
                <li key={result.requirement_id}>
                  <strong>{requirement ? requirementText(requirement) : result.requirement_id}</strong>: {result.problem}
                  {result.fix && <> Suggested fix: {result.fix}</>}
                </li>
              );
            })}
          </ul>
          <button className="text-button" onClick={onEdit}>
            Edit the details
          </button>
        </>
      )}
    </section>
  );
}
export function InstallPage({
  agent,
  notify,
  onEdit,
  personal = {},
}: {
  agent: AgentSpec;
  notify: (message: string) => void;
  onEdit: () => void;
  // The owner's own values for per-user settings. Shown here; never written to a download.
  personal?: Record<string, string>;
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
      {(agent.settings?.length || agent.schedule) && (
        <section className="details-section" aria-label="Your settings">
          <h3>Set these yourself</h3>
          {(agent.settings || []).map((setting) => (
            <p key={setting.id}>
              <strong>{setting.label}</strong>: not stored in the download.{" "}
              {setting.env && (
                <code>
                  {setting.env}={personal[setting.id]?.trim() || "you@example.com"}
                </code>
              )}
            </p>
          ))}
          {agent.schedule && (
            <p>
              <strong>Schedule</strong>: meant to run {requirementText({ type: "trigger", value: agent.schedule.cadence }).replace("Runs on its own ", "")}. Downloads can’t start themselves; add it to your own scheduler.
            </p>
          )}
        </section>
      )}
      <CompletenessCheck agent={agent} onEdit={onEdit} />
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
