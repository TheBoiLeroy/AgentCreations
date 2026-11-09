"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Copy, Download, Plus, ShieldCheck, User } from "lucide-react";
import { z } from "zod";
import { installScript, setupItemSchema, skillCommand, type SetupItem } from "@agents/spec/setups";
import { archive, skillFiles } from "@agents/exporters";
import { addToLibrary } from "../lib/library";
import { AgentIcon } from "./agent-icon";
import { download } from "./install-page";
import { SiteHeader } from "./site-header";

export interface Profile {
  handle: string;
  display_name: string;
  avatar_url: string | null;
}
export interface SetupSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  item_count: number;
  published: boolean;
  revision: number;
  updated_at: string;
  profiles?: Profile;
  items?: unknown;
}
/** GET a JSON API. `error` carries the server's own message, e.g. "not configured". */
export function useJson<T>(url: string, version = 0) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let active = true;
    setState({});
    fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) })
      .then(async (response) => {
        const body = await response.json();
        if (!active) return;
        setState(response.ok ? { data: body as T } : { error: body.error || "Could not load this page." });
      })
      .catch(() => active && setState({ error: "Could not reach the server. Try again." }));
    return () => {
      active = false;
    };
  }, [url, version]);
  return state;
}
export function Avatar({ profile }: { profile: Profile }) {
  // Only GitHub-hosted avatars are stored; check again before loading a remote image.
  return profile.avatar_url?.startsWith("https://avatars.githubusercontent.com/") ? (
    <img className="avatar" src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar" aria-hidden="true">
      <User size={24} />
    </span>
  );
}
export function Shell({ active, children }: { active?: "/explore" | "/me"; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader active={active} />
      <main>
        <section className="library">{children}</section>
      </main>
    </>
  );
}
function Status({ error, loading }: { error?: string; loading: boolean }) {
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  return loading ? <p className="loading">Loading…</p> : null;
}
export function SetupCards({ setups, handle }: { setups: SetupSummary[]; handle?: string }) {
  return (
    <div className="library-grid">
      {setups.map((setup) => {
        const owner = handle || setup.profiles?.handle;
        return (
          <article className="saved-card" key={setup.id}>
            <h2>{setup.title}</h2>
            {!handle && owner && (
              <a className="byline" href={`/u/${owner}`}>
                by @{owner}
              </a>
            )}
            <code>
              {setup.item_count} item{setup.item_count === 1 ? "" : "s"}
            </code>
            <p>{setup.description || "No description yet."}</p>
            <div className="actions">
              <a className="button" href={`/u/${owner}/${setup.slug}`}>
                View setup <ArrowRight size={14} />
              </a>
            </div>
          </article>
        );
      })}
    </div>
  );
}
export function ExplorePage() {
  const { data, error } = useJson<{ setups: SetupSummary[] }>("/api/setups");
  return (
    <Shell active="/explore">
      <div className="page-heading">
        <span className="eyebrow">HOW OTHER PEOPLE WORK</span>
        <h1>Explore setups</h1>
        <p>The skills and agents people use together. Open one to copy the whole set.</p>
      </div>
      <Status error={error} loading={!data} />
      {data && !data.setups.length && (
        <div className="empty">
          <h2>No setups published yet.</h2>
          <a className="button primary" href="/me">
            Publish yours <ArrowRight size={15} />
          </a>
        </div>
      )}
      {data && <SetupCards setups={data.setups} />}
    </Shell>
  );
}
export function ProfilePage({ handle }: { handle: string }) {
  const { data, error } = useJson<{ profile: Profile; setups: SetupSummary[] }>(
    `/api/setups?handle=${encodeURIComponent(handle)}`,
  );
  return (
    <Shell>
      <Status error={error} loading={!data} />
      {data && (
        <>
          <div className="profile-head">
            <Avatar profile={data.profile} />
            <div>
              <h1>{data.profile.display_name}</h1>
              <p>@{data.profile.handle}</p>
            </div>
          </div>
          {!data.setups.length && <p className="hint">No published setups yet.</p>}
          <SetupCards setups={data.setups} handle={data.profile.handle} />
        </>
      )}
    </Shell>
  );
}
export function SetupPage({ handle, slug }: { handle: string; slug: string }) {
  const { data, error } = useJson<{ profile: Profile; setup: SetupSummary }>(
    `/api/setups?handle=${encodeURIComponent(handle)}&slug=${encodeURIComponent(slug)}`,
  );
  const [notice, setNotice] = useState("");
  // Stored content is other people's data: validate before rendering or exporting it.
  const parsed = data && z.array(setupItemSchema).max(30).safeParse(data.setup.items);
  const items: SetupItem[] = parsed?.success ? parsed.data : [];
  const script = installScript(items);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const scriptUrl = data ? `${origin}/u/${data.profile.handle}/${data.setup.slug}/install.sh` : "";
  // Download, then run: the skills CLI can still ask questions in your terminal (a piped script can't).
  const command = `curl -fsSL '${scriptUrl}' -o setup.sh && sh setup.sh`;
  const agents = items.flatMap((item) => (item.kind === "agent" ? [item] : []));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setNotice("Copied the install command.");
    } catch {
      setNotice("Clipboard unavailable. Select and copy the text manually.");
    }
  };
  return (
    <Shell>
      <Status
        error={error || (parsed && !parsed.success ? "This setup has items this version of the site can't read." : undefined)}
        loading={!data}
      />
      {data && parsed?.success && (
        <>
          <div className="page-heading">
            <a className="eyebrow" href={`/u/${data.profile.handle}`}>
              A SETUP BY @{data.profile.handle.toUpperCase()}
            </a>
            <h1>{data.setup.title}</h1>
            <p>{data.setup.description}</p>
          </div>
          {notice && (
            <div role="status" className="notice">
              {notice}
            </div>
          )}
          {items.length > 0 && origin && (
            <section aria-label="Install everything">
              <div className="install-card">
                <div className="code-label">
                  <span>INSTALL EVERYTHING · ONE COMMAND</span>
                  <button onClick={() => void copy()}>
                    <Copy size={14} /> Copy
                  </button>
                </div>
                <pre>{command}</pre>
              </div>
              <p className="install-note hint">
                Adds {items.length - agents.length} skill{items.length - agents.length === 1 ? "" : "s"} with “npx skills add” and
                writes {agents.length} agent{agents.length === 1 ? "" : "s"} to ~/.claude/skills, skipping any that already exist.
                For one project, run <code>SKILLS_DIR=.claude/skills sh setup.sh</code>.{" "}
                <a href={scriptUrl} target="_blank" rel="noopener noreferrer">
                  Read the script first
                </a>
                .
              </p>
            </section>
          )}
          {script && (
            <>
              <div className="section-label">
                <span>SKILLS</span>
                <span>{items.length - agents.length} referenced</span>
              </div>
              {items.map(
                (item) =>
                  item.kind === "skill" && (
                    <div className="setup-item" key={`${item.repository}/${item.skill}`}>
                      <strong>{item.skill}</strong>
                      {item.note && <p>{item.note}</p>}
                      <span>
                        <a href={`https://github.com/${item.repository}`} target="_blank" rel="noopener noreferrer">
                          {item.repository} on GitHub
                        </a>
                        {" · "}
                        <a href={`https://skills.sh/${item.repository}/${item.skill}`} target="_blank" rel="noopener noreferrer">
                          skills.sh listing
                        </a>
                      </span>
                      <code>{skillCommand(item)}</code>
                    </div>
                  ),
              )}
              <p className="safety">
                <ShieldCheck size={17} /> These commands install code from each skill’s own repository. Agent
                Creations stores the links only and has not reviewed that code. Read each source before you run it.
              </p>
            </>
          )}
          {agents.length > 0 && (
            <>
              <div className="section-label">
                <span>AGENTS BUILT HERE</span>
                <span>{agents.length} included</span>
              </div>
              {agents.map(({ spec, note }) => (
                <div className="setup-item" key={spec.trigger}>
                  <AgentIcon category={spec.category} size={42} />
                  <strong>{spec.name}</strong>
                  <code>/{spec.trigger}</code>
                  <p>{note || spec.description}</p>
                  <div className="actions">
                    <button
                      className="button"
                      onClick={() => {
                        try {
                          download(`${spec.slug}-skill.zip`, archive(skillFiles(spec)), "application/zip");
                          setNotice("Download ready. Review the files before installing.");
                        } catch (error) {
                          setNotice(error instanceof Error ? error.message : "This agent can’t be exported as a skill.");
                        }
                      }}
                    >
                      <Download size={14} /> Download skill
                    </button>
                    <button
                      className="button"
                      onClick={() => {
                        try {
                          const saved = addToLibrary(spec);
                          setNotice(`Added “${saved.name}” to My agents as /${saved.trigger}. Open the workshop to edit or export it.`);
                        } catch {
                          setNotice("Device storage is unavailable. Download the skill instead.");
                        }
                      }}
                    >
                      <Plus size={14} /> Add to my agents
                    </button>
                  </div>
                </div>
              ))}
              <p className="safety">
                <ShieldCheck size={17} /> Agent instructions were written by @{data.profile.handle}. Read them
                before installing; they are not reviewed and are not a security sandbox.
              </p>
            </>
          )}
        </>
      )}
    </Shell>
  );
}
