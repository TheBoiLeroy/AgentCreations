"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Github, Plus, X } from "lucide-react";
import { z } from "zod";
import { triggerFromName } from "@agents/spec";
import { parseSkillReference, setupItemSchema, setupSchema, type SetupItem } from "@agents/spec/setups";
import { catalog, getSkillSource } from "@agents/jev";
import { readLibrary, type SavedAgent } from "../lib/library";
import { Avatar, Shell, useJson, type Profile, type SetupSummary } from "./setups";

type Me = { configured: boolean; profile: Profile | null; setups: SetupSummary[] };
const authNotices: Record<string, string> = {
  failed: "GitHub sign-in didn’t finish. Try again.",
  unavailable: "Sign-in isn’t available: this site has no cloud storage configured.",
  profile: "You’re signed in, but your profile couldn’t be created. Check the profiles_setups migration.",
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

function Editor({ start, onDone }: { start: Draft; onDone: (saved: boolean) => void }) {
  const [draft, setDraft] = useState(start);
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [library, setLibrary] = useState<SavedAgent[]>([]);
  useEffect(() => {
    try {
      setLibrary(readLibrary());
    } catch {
      /* No readable library on this device; skills can still be added. */
    }
  }, []);
  const has = (item: SetupItem) => draft.items.some((x) => itemKey(x) === itemKey(item));
  const add = (item: SetupItem) => {
    if (has(item)) return setError("That’s already in this setup.");
    if (draft.items.length >= 30) return setError("A setup holds up to 30 items.");
    setError("");
    setDraft({ ...draft, items: [...draft.items, item] });
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
            {data.configured
              ? "Sign in with GitHub to publish your setup. Your GitHub username becomes your profile address."
              : "Profiles need cloud storage, which is not configured on this site. See the README to set up Supabase and GitHub sign-in."}
          </p>
          {data.configured && (
            <a className="button primary" href="/auth/sign-in">
              <Github size={15} /> Sign in with GitHub
            </a>
          )}
        </div>
      )}
      {data?.profile &&
        (editing ? (
          <Editor
            key={editing.id || "new"}
            start={editing}
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
              <button className="button primary" onClick={() => setEditing(blank)}>
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
