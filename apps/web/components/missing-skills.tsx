"use client";
import { useState } from "react";

export function MissingSkills({ term }: { term: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function requestSkill() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/skill-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request could not be saved.");
      setMessage("Request saved for this browser’s account. Thank you.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request could not be saved.");
    } finally { setBusy(false); }
  }
  return <section className="details-section" aria-label="Missing skill options">
    <h3>Can’t find it?</h3>
    <p><strong>Describe it and Jev will build it</strong><br />Not available yet: private custom-skill generation and execution testing are not connected.</p>
    <p><strong>Import one</strong><br />GitHub SKILL.md and MCP import are not available yet. External code and servers must be reviewed before execution.</p>
    <button className="text-button" disabled={busy || !term.trim() || term.trim().length > 200} onClick={requestSkill}>
      {busy ? "Saving request…" : "Request it"}
    </button>
    <p className="hint">Records this search and your browser’s account when cloud storage is configured. No request is saved locally.</p>
    <p aria-live="polite">{message}</p>
  </section>;
}
