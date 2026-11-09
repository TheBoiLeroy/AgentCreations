"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Github, Plus, Upload, Wand2, X } from "lucide-react";
import { z } from "zod";
import { parseAgentSpec, triggerFromName } from "@agents/spec";
import {
  parseSetupImport,
  parseSkillReference,
  setupFromAgents,
  SETUP_MAX_ITEMS,
  setupItemSchema,
  setupSchema,
  type SetupItem,
} from "@agents/spec/setups";
import { catalog, getSkillSource } from "@agents/jev";
import { readLibrary, type SavedAgent } from "../lib/library";
import { Avatar, Shell, useJson, type Profile, type SetupSummary } from "./setups";

type Me = {
  configured: boolean;
  signIn?: { github: boolean; dev: boolean };
  profile: Profile | null;
  setups: SetupSummary[];
};
const authNotices: Record<string, string> = {
  failed: "GitHub sign-in didn’t finish. Try again.",
  unavailable: "GitHub sign-in isn’t set up on this site yet. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (see the README).",
  handle: "That profile name already belongs to another account.",
  "dev-handle": "Use letters, numbers and single hyphens, up to 39 characters.",
};
const itemKey = (item: SetupItem) =>
  item.kind === "skill" ? `skill:${item.repository}/${item.skill}`.toLowerCase() : `agent:${item.spec.trigger}`;
const suggestions = catalog.flatMap((tool) => {
  const source = getSkillSource(tool.id);
  return source ? [{ name: tool.name, ...source }] : [];
});
interface Draft {
  id?: string;
  revision: number;
  slug: string;
  title: string;
  description: string;
  items: SetupItem[];
  published: boolean;
}
const blank: Draft = { revision: 0, slug: "", title: "", description: "", items: [], published: true };

type Choice = { name: string; options: { repository: string; skill: string; from: string; uses: number }[] };
/** Agents built on this device plus those saved to the database, newest first, one per command. */
function useMyAgents() {
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  useEffect(() => {
    let local: SavedAgent[] = [];
    try {
      local = readLibrary();
    } catch {
      /* No readable library on this device. */
    }
    setAgents(local);
    fetch("/api/agent-builds", { cache: "no-store", signal: AbortSignal.timeout(10000) })
      .then((response) => (response.ok ? response.json() : { builds: [] }))
      .then(({ builds }: { builds: { id: string; spec: unknown }[] }) => {
        const saved = builds.flatMap((build) => {
          try {
            return build.spec ? [{ id: build.id, spec: parseAgentSpec(build.spec) }] : [];
          } catch {
            return [];
          }
        });
        const seen = new Set<string>();
        setAgents(
          [...[...local].reverse(), ...saved].filter(({ spec }) => !seen.has(spec.trigger) && !!seen.add(spec.trigger)),
        );
      })
      .catch(() => undefined);
  }, []);
  return agents;
}
function Editor({ start, autofill, onDone }: { start: Draft; autofill?: boolean; onDone: (saved: boolean) => void }) {
  const [draft, setDraft] = useState(start);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const library = useMyAgents();
  const [pasted, setPasted] = useState("");
  const [report, setReport] = useState<{ added: number; problems: string[]; unknown: string[] } | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [importing, setImporting] = useState(false);
  const has = (item: SetupItem) => draft.items.some((x) => itemKey(x) === itemKey(item));
  // The latest items, readable after an await (state updates apply later).
  const items = useRef(draft.items);
  items.current = draft.items;
  /** Adds what fits and isn't there yet. Returns how many were new. */
  const addMany = (incoming: SetupItem[]) => {
    const keys = new Set(items.current.map(itemKey));
    const fresh = incoming.filter((item) => !keys.has(itemKey(item)) && !!keys.add(itemKey(item)));
    const room = fresh.slice(0, Math.max(0, SETUP_MAX_ITEMS - items.current.length));
    if (room.length < fresh.length) setError(`A setup holds up to ${SETUP_MAX_ITEMS} items; the rest weren’t added.`);
    items.current = [...items.current, ...room];
    setDraft((current) => ({ ...current, items: items.current }));
    return room.length;
  };
  const add = (item: SetupItem) => {
    if (has(item)) return setError("That’s already in this setup.");
    if (draft.items.length >= SETUP_MAX_ITEMS) return setError(`A setup holds up to ${SETUP_MAX_ITEMS} items.`);
    setError("");
    addMany([item]);
  };
  const fromAgents = () => {
    if (!library.length) return setError("No agents yet. Build one in the workshop first.");
    setError("");
    const proposal = setupFromAgents(library.map(({ spec }) => spec));
    setDraft((current) => ({
      ...current,
      title: current.title || proposal.title,
      description: current.description || proposal.description,
    }));
    addMany(proposal.items);
  };
  // "Start from my agents" on /me opens the editor already filled in.
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (autofill && !filled && library.length) {
      setFilled(true);
      fromAgents();
    }
  }, [autofill, filled, library]); // eslint-disable-line react-hooks/exhaustive-deps
  const runImport = async (text: string) => {
    if (!text.trim()) return;
    setImporting(true);
    setError("");
    const parsed = parseSetupImport(text);
    // Names of my own agents become those agents; the rest are looked up.
    const mine = new Map(library.map(({ spec }) => [spec.trigger, spec]));
    const agents: SetupItem[] = parsed.names.flatMap((name) => (mine.has(name) ? [{ kind: "agent" as const, spec: mine.get(name)!, note: "" }] : []));
    const lookup = parsed.names.filter((name) => !mine.has(name));
    const resolved: SetupItem[] = [];
    const ambiguous: Choice[] = [];
    const unknown: string[] = [];
    if (lookup.length)
      try {
        const response = await fetch("/api/setups/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names: lookup.filter((name) => /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name)) }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error();
        const { matches } = (await response.json()) as { matches: Record<string, Choice["options"]> };
        for (const name of lookup) {
          const options = matches[name] || [];
          if (options.length === 1) resolved.push({ kind: "skill", repository: options[0].repository, skill: options[0].skill, note: "" });
          else if (options.length > 1) ambiguous.push({ name, options });
          else unknown.push(name);
        }
      } catch {
        unknown.push(...lookup);
      }
    const added = addMany([...parsed.items, ...agents, ...resolved]);
    setChoices(ambiguous);
    setReport({ added, problems: parsed.problems, unknown });
    setImporting(false);
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 200000) return setError("That file is too large to import (200 KB at most).");
    const text = await file.text();
    setPasted(text);
    await runImport(text);
  };
  const addReference = () => {
    const parsed = parseSkillReference(reference);
    if (!parsed)
      return setError("Paste a skills.sh link, an “npx skills add … --skill …” command, or owner/repository/skill.");
    add({ kind: "skill", ...parsed, note: "" });
    setReference("");
  };
  const save = async () => {
    // Keep a published link stable: the slug is set once, from the first title.
    const body = setupSchema.safeParse({
      title: draft.title,
      slug: draft.slug || triggerFromName(draft.title),
      description: draft.description,
      items: draft.items,
      published: draft.published,
    });
    if (!body.success) return setError(body.error.issues[0].message);
    setSaving(true);
    setError("");
    try {
      const response = await fetch(draft.id ? `/api/setups/${draft.id}` : "/api/setups", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify(draft.id ? { setup: body.data, revision: draft.revision } : body.data),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Could not save.");
      onDone(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save.");
      setSaving(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">{draft.id ? "EDIT SETUP" : "NEW SETUP"}</span>
        <h1>Package the skills you use.</h1>
        <p>Link the skills in your workflow and add agents you built here. Anyone can copy the set.</p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset className="details-section">
        <legend>About</legend>
        <label>
          Title
          <input
            value={draft.title}
            maxLength={80}
            placeholder="My daily driver"
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <label>
          What it’s for (optional)
          <textarea
            rows={2}
            maxLength={500}
            placeholder="How I plan, build and review with agents."
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
      </fieldset>
      <fieldset className="details-section">
        <legend>In this setup</legend>
        {!draft.items.length && <p className="hint">Nothing yet. Add a skill or an agent below.</p>}
        {draft.items.map((item, i) => {
          const name = item.kind === "skill" ? `${item.repository} · ${item.skill}` : `${item.spec.name} (agent)`;
          return (
            <div className="setup-item" key={itemKey(item)}>
              <strong>{name}</strong>
              <label>
                Why you use it (optional)
                <input
                  value={item.note}
                  maxLength={300}
                  aria-label={`Note for ${name}`}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)),
                    })
                  }
                />
              </label>
              <button
                className="text-button"
                aria-label={`Remove ${name}`}
                onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}
              >
                <X size={13} /> Remove
              </button>
            </div>
          );
        })}
      </fieldset>
      <fieldset className="details-section">
        <legend>Bring in what you already use</legend>
        <div className="actions">
          <button className="button" onClick={fromAgents}>
            <Wand2 size={14} /> Add all my agents and their skills
          </button>
          <span className="hint">{library.length} agent{library.length === 1 ? "" : "s"} found in the workshop.</span>
        </div>
        <label htmlFor="setup-import">Import your setup</label>
        <textarea
          id="setup-import"
          rows={5}
          maxLength={200000}
          placeholder={"Paste skill links, “npx skills add …” commands, GitHub skill folders,\nan agent JSON, or the output of: ls ~/.claude/skills"}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
        <div className="actions">
          <button className="button" disabled={!pasted.trim() || importing} onClick={() => void runImport(pasted)}>
            {importing ? "Reading…" : "Import"}
          </button>
          <label className="button">
            <Upload size={14} /> Upload a file
            <input
              className="sr-only"
              type="file"
              accept=".json,.md,.txt,application/json,text/plain,text/markdown"
              aria-label="Upload a setup or agent file"
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {report && (
          <div className="hint" role="status" aria-label="Import result">
            <p>
              Added {report.added} item{report.added === 1 ? "" : "s"}.
            </p>
            {report.unknown.length > 0 && (
              <p>
                No public source found for: {report.unknown.join(", ")}. Paste a link for each (skills that live only on
                your machine can’t be shared yet).
              </p>
            )}
            {report.problems.map((problem) => (
              <p key={problem}>{problem}</p>
            ))}
          </div>
        )}
        {choices.map((choice) => (
          <div className="chips" role="group" aria-label={`Which ${choice.name}?`} key={choice.name}>
            <span className="hint">Which “{choice.name}”?</span>
            {choice.options.map((option) => (
              <button
                key={option.repository}
                onClick={() => {
                  add({ kind: "skill", repository: option.repository, skill: option.skill, note: "" });
                  setChoices((list) => list.filter((c) => c.name !== choice.name));
                }}
              >
                <Plus size={12} /> {option.repository}
                {option.from === "setups" ? ` · in ${option.uses} setup${option.uses === 1 ? "" : "s"}` : ""}
              </button>
            ))}
          </div>
        ))}
      </fieldset>
      <fieldset className="details-section">
        <legend>Add a skill</legend>
        <label htmlFor="skill-reference">Skill link or install command</label>
        <input
          id="skill-reference"
          value={reference}
          maxLength={400}
          placeholder="https://skills.sh/owner/repository/skill"
          onChange={(e) => setReference(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addReference()}
        />
        <div className="actions">
          <button className="button" disabled={!reference.trim()} onClick={addReference}>
            <Plus size={14} /> Add skill
          </button>
        </div>
        <div className="chips" role="group" aria-label="Popular skills">
          {suggestions.map((skill) => (
            <button
              key={skill.skill}
              disabled={has({ kind: "skill", repository: skill.repository, skill: skill.skill, note: "" })}
              onClick={() => add({ kind: "skill", repository: skill.repository, skill: skill.skill, note: "" })}
            >
              <Plus size={12} /> {skill.name}
            </button>
          ))}
        </div>
        <p className="hint">
          The setup stores a link to the skill’s repository, not its code. The skill must be in a public
          repository that “npx skills add” can read.
        </p>
      </fieldset>
      <fieldset className="details-section">
        <legend>Add an agent you built</legend>
        {!library.length && (
          <p className="hint">
            No agents on this device yet. <a href="/">Build one in the workshop</a>, then come back.
          </p>
        )}
        <div className="chips" role="group" aria-label="Your agents">
          {library.map(({ id, spec }) => (
            <button
              key={id}
              disabled={has({ kind: "agent", spec, note: "" })}
              onClick={() => add({ kind: "agent", spec, note: "" })}
            >
              <Plus size={12} /> {spec.name}
            </button>
          ))}
        </div>
        <p className="hint">
          The agent’s full instructions and configured answers are published with the setup. Check them for
          anything private first.
        </p>
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.published}
          onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
        />
        Show this setup on my public profile
      </label>
      <div className="page-actions">
        <button className="text-button" onClick={() => onDone(false)}>
          Cancel
        </button>
        <button className="button primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : draft.published ? "Save and publish" : "Save as private draft"}
        </button>
      </div>
    </>
  );
}
export function MyPage() {
  const [version, setVersion] = useState(0);
  const { data, error } = useJson<Me>("/api/me", version);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [autofill, setAutofill] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setNotice(authNotices[new URLSearchParams(window.location.search).get("auth") || ""] || "");
  }, []);
  const edit = (setup: SetupSummary) => {
    const items = z.array(setupItemSchema).safeParse(setup.items);
    if (!items.success) return setNotice("This setup has items this version of the site can’t read.");
    setEditing({ ...setup, items: items.data });
  };
  const remove = async (setup: SetupSummary) => {
    if (!window.confirm(`Delete “${setup.title}”? Its public link will stop working.`)) return;
    const response = await fetch(`/api/setups/${setup.id}`, { method: "DELETE" }).catch(() => null);
    setNotice(response?.ok ? "Setup deleted." : "Could not delete this setup. Try again.");
    setVersion((n) => n + 1);
  };
  return (
    <Shell active="/me">
      {notice && (
        <div role="status" className="notice">
          {notice}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="loading">Loading…</p>}
      {data && !data.profile && (
        <div className="empty">
          <h2>Share how you work.</h2>
          <p className="hint">
            {data.signIn?.github
              ? "Sign in with GitHub to publish your setup. Your GitHub username becomes your profile address."
              : "GitHub sign-in isn’t set up on this site yet: add a GitHub OAuth app’s client ID and secret (see the README)."}
          </p>
          {data.signIn?.github && (
            <a className="button primary" href="/auth/sign-in">
              <Github size={15} /> Sign in with GitHub
            </a>
          )}
          {data.signIn?.dev && (
            <form method="post" action="/auth/dev-sign-in" className="dev-sign-in">
              <label htmlFor="dev-handle">Local dev sign-in (only on your machine under next dev)</label>
              <span className="describe-actions">
                <input id="dev-handle" name="handle" required maxLength={39} placeholder="your-github-name" autoComplete="off" />
                <button className="button">Sign in locally</button>
              </span>
            </form>
          )}
        </div>
      )}
      {data?.profile &&
        (editing ? (
          <Editor
            key={editing.id || "new"}
            start={editing}
            autofill={autofill}
            onDone={(saved) => {
              setEditing(null);
              if (saved) {
                setNotice("Setup saved.");
                setVersion((n) => n + 1);
              }
            }}
          />
        ) : (
          <>
            <div className="profile-head">
              <Avatar profile={data.profile} />
              <div>
                <h1>{data.profile.display_name}</h1>
                <p>
                  <a href={`/u/${data.profile.handle}`}>agentcreations/u/{data.profile.handle}</a>
                </p>
              </div>
            </div>
            <div className="actions">
              <button
                className="button primary"
                onClick={() => {
                  setAutofill(true);
                  setEditing(blank);
                }}
              >
                <Wand2 size={15} /> Start from my agents
              </button>
              <button
                className="button"
                onClick={() => {
                  setAutofill(false);
                  setEditing(blank);
                }}
              >
                <Plus size={15} /> New setup
              </button>
              <form method="post" action="/auth/sign-out">
                <button className="text-button">Sign out</button>
              </form>
            </div>
            {!data.setups.length && <p className="hint">You haven’t made a setup yet.</p>}
            <div className="library-grid">
              {data.setups.map((setup) => (
                <article className="saved-card" key={setup.id}>
                  <span className="pill">{setup.published ? "Published" : "Private draft"}</span>
                  <h2>{setup.title}</h2>
                  <code>
                    {setup.item_count} item{setup.item_count === 1 ? "" : "s"}
                  </code>
                  <p>{setup.description || "No description yet."}</p>
                  <div className="actions">
                    <button className="button" onClick={() => edit(setup)}>
                      Edit
                    </button>
                    {setup.published && (
                      <a className="button" href={`/u/${data.profile!.handle}/${setup.slug}`}>
                        View <ArrowRight size={14} />
                      </a>
                    )}
                    <button className="text-button" onClick={() => void remove(setup)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ))}
    </Shell>
  );
}
