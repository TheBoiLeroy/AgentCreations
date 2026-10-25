"use client";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Plus,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  categories,
  inputTypes,
  specProblems,
  type AgentSpec,
  type BuildDetails,
  type BuildDraft,
} from "@agents/spec";
import { exportProblems } from "@agents/exporters";
import {
  catalog,
  classifyRuntime,
  skillQuestions,
  usesSkillQuestions,
  pendingQuestions,
  getSkillSource,
  inputChips,
  outputChips,
  createAgentSpec,
  recommendRules,
  jevResultSchema,
  type JevInput,
} from "@agents/jev";
import type { Action } from "../lib/build-machine";
import { AgentIcon } from "./agent-icon";
import { MissingSkills } from "./missing-skills";
export interface PageProps {
  draft: BuildDraft;
  dispatch: React.Dispatch<Action>;
  trigger: string;
}
export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1 tabIndex={-1} data-step-heading>
        {title}
      </h1>
      <p>{children}</p>
    </div>
  );
}
function Next({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="button primary" onClick={onClick} disabled={disabled}>
      {children}
      <ArrowRight size={17} />
    </button>
  );
}
export function CategoryPage({ draft, dispatch }: PageProps) {
  const [active, setActive] = useState<BuildDraft["category"]>();
  return (
    <>
      <PageHeading
        eyebrow="01 / A LITTLE DIRECTION"
        title="What kind of help do you need?"
      >
        Pick a purpose. We’ll find the right skills together.
      </PageHeading>
      <div className="category-grid" aria-label="Agent category">
        {categories.map((category) => (
          <button
            key={category.id}
            className={`category-tile ${draft.category === category.id ? "selected" : ""}`}
            aria-pressed={draft.category === category.id}
            onPointerEnter={() => setActive(category.id)}
            onPointerLeave={() =>
              setActive((id) => (id === category.id ? undefined : id))
            }
            onFocus={() => setActive(category.id)}
            onBlur={() =>
              setActive((id) => (id === category.id ? undefined : id))
            }
            onClick={() =>
              dispatch({ type: "category", category: category.id })
            }
          >
            <div className="category-art">
              <AgentIcon
                category={category.id}
                motion="gif"
                playing={
                  active === category.id || draft.category === category.id
                }
              />
            </div>
            <h2>{category.name}</h2>
            <p>{category.detail}</p>
            <span className="category-bottom">
              {draft.category === category.id
                ? "Added to agent build"
                : "Choose this direction"}
              {draft.category === category.id ? (
                <Check size={14} />
              ) : (
                <ArrowRight size={14} />
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="page-actions right">
        <Next
          disabled={!draft.category}
          onClick={() => dispatch({ type: "navigate", step: "name" })}
        >
          Name your agent
        </Next>
      </div>
    </>
  );
}
export function NamePage({ draft, dispatch, trigger }: PageProps) {
  return (
    <>
      <PageHeading
        eyebrow="02 / MAKE IT YOURS"
        title="Every good helper needs a name."
      >
        Something memorable. Something that feels like yours.
      </PageHeading>
      <div className="narrow-form">
        <label htmlFor="agent-name">Name your agent</label>
        <input
          id="agent-name"
          className="name-input"
          value={draft.name}
          maxLength={80}
          placeholder="Quote Writer"
          autoComplete="off"
          onChange={(e) => dispatch({ type: "name", name: e.target.value })}
        />
        <div className="trigger-preview">
          <span>Your shortcut</span>
          <code data-testid="trigger">/{trigger}</code>
          <span className="pill">Auto-generated</span>
        </div>
        <p className="hint">
          We turn the name into a trigger for you. If it’s taken, we’ll add -2,
          -3, and so on. Cloud saves reserve it for this browser’s user.
        </p>
        <div className="page-actions right">
          <Next
            disabled={!draft.name.trim()}
            onClick={() => dispatch({ type: "navigate", step: "needs" })}
          >
            Tell us what it needs
          </Next>
        </div>
      </div>
    </>
  );
}
export function NeedsPage({ draft, dispatch }: PageProps) {
  const valid =
    !!draft.context.trim() ||
    (!!draft.inputChips.length && !!draft.outputChips.length);
  return (
    <>
      <PageHeading
        eyebrow="03 / FROM THIS, TO THAT"
        title="What will your agent need?"
      >
        Start with the ingredients. Then tell us what a good result looks like.
      </PageHeading>
      <div className="needs-grid">
        {(
          [
            {
              group: "inputChips",
              title: "It starts with…",
              chips: inputChips,
            },
            {
              group: "outputChips",
              title: "And gives back…",
              chips: outputChips,
            },
          ] as const
        ).map(({ group, title, chips }) => (
          <fieldset key={group}>
            <legend>{title}</legend>
            <div className="chips">
              {chips.map((chip) => (
                <button
                  key={chip.id}
                  className={draft[group].includes(chip.id) ? "selected" : ""}
                  aria-pressed={draft[group].includes(chip.id)}
                  onClick={() => dispatch({ type: "chip", group, id: chip.id })}
                >
                  {draft[group].includes(chip.id) && <Check size={13} />}{" "}
                  {chip.label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <label htmlFor="agent-context">Anything else Jev should know?</label>
      <textarea
        id="agent-context"
        rows={5}
        maxLength={12000}
        placeholder="For example: Read customer emails and draft a friendly quote. Ask me before sending anything."
        value={draft.context}
        onChange={(e) => dispatch({ type: "context", context: e.target.value })}
      />
      <div className="field-caption">
        <span>Plain language is perfect. Keep passwords and API keys out.</span>
        <span>{draft.context.length.toLocaleString()} / 12,000</span>
      </div>
      <div className="page-actions">
        <span className="subtle">
          <Sparkles size={15} /> Jev will suggest the tools. You stay in charge.
        </span>
        <Next
          disabled={!valid}
          onClick={() =>
            dispatch({
              type: "navigate",
              step: draft.recommendations.length ? "tools" : "jev",
            })
          }
        >
          Find my agent’s skills
        </Next>
      </div>
    </>
  );
}
export function JevPage({ draft, dispatch }: PageProps) {
  const reduced = useReducedMotion();
  const input: JevInput = {
    category: draft.category!,
    inputChips: draft.inputChips,
    outputChips: draft.outputChips,
    context: draft.context,
  };
  const rules = recommendRules(input);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let result = rules;
      try {
        const response = await fetch("/api/jev", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (!response.ok) throw new Error("Jev unavailable");
        result = jevResultSchema.parse(await response.json());
      } catch {
        result = { ...rules, mode: "fallback" };
      }
      if (!active) return;
      timer = setTimeout(
        () => {
          if (active) dispatch({ type: "recommended", result });
        },
        Math.max(0, (reduced ? 0 : 1200) - (Date.now() - started)),
      );
    })();
    return () => {
      active = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // This page is a single cancellable transition. Editing needs remounts it with fresh input.
  }, [dispatch]);
  return (
    <div className="jev-page">
      <div className="jev-orb">
        <Sparkles size={38} />
      </div>
      <PageHeading eyebrow="A SECOND PAIR OF EYES" title="Jev is reading…">
        Connecting what you need with the tools that can help.
      </PageHeading>
      <div className="noticed" aria-label="Words Jev noticed">
        {(rules.noticed.length
          ? rules.noticed
          : ["Your agent’s purpose", "A useful starting point"]
        ).map((word, i) => (
          <motion.span
            key={word}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: reduced ? 0 : i * 0.08,
              duration: reduced ? 0 : 0.36,
            }}
          >
            {word}
          </motion.span>
        ))}
      </div>
      <p className="hint">
        Chips and keywords first. An optional model adds ideas, never
        permissions.
        <br />
        You can change every recommendation on the next page.
      </p>
    </div>
  );
}
export function ToolsPage({ draft, dispatch }: PageProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [visibleCount, setVisibleCount] = useState(6);
  const [browseOpen, setBrowseOpen] = useState(false);
  const recommended = new Set(draft.recommendations.map((r) => r.id));
  const search = query.trim().toLowerCase();
  const matches = catalog.filter((tool) =>
    (category === "All" || tool.category === category) &&
    `${tool.name} ${tool.description} ${tool.id}`.toLowerCase().includes(search),
  );
  const suggested = matches.filter((tool) => recommended.has(tool.id));
  const other = matches.filter((tool) => !recommended.has(tool.id));
  const cards = (tools: readonly (typeof catalog)[number][]) =>
    tools.map((tool) => {
        const pick = draft.recommendations.find((r) => r.id === tool.id);
        const source = getSkillSource(tool.id);
        return (
          <label
            className={`tool-card ${draft.selectedTools.includes(tool.id) ? "selected" : ""}`}
            key={tool.id}
          >
            <div className="tool-card-heading">
              <span className="tool-symbol">
                {tool.requiresApproval ? (
                  <ShieldCheck size={19} />
                ) : (
                  <Sparkles size={19} />
                )}
              </span>
              <strong>{tool.name}</strong>
              <input
                type="checkbox"
                role="switch"
                aria-label={tool.name}
                checked={draft.selectedTools.includes(tool.id)}
                onChange={() => dispatch({ type: "toggle-tool", id: tool.id })}
              />
            </div>
            <p>{tool.description}</p>
            {source && (
              <div className="tool-reason">
                <a
                  href={`https://skills.sh/${source.repository}/${source.skill}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on skills.sh · {source.repository}
                </a>
                <span>External skill · manual installation required. Review the source and dependencies first.</span>
                <code style={{ overflowWrap: "anywhere" }}>
                  npx skills add {source.repository} --skill {source.skill}
                </code>
              </div>
            )}
            {pick && (
              <div className="tool-reason">
                {pick.reason}
                <span>
                  {Math.round(pick.confidence * 100)}% confidence ·{" "}
                  {pick.source}
                </span>
              </div>
            )}
            {tool.requiresApproval && (
              <span className="approval">
                <ShieldCheck size={12} /> Asks before sending or changing
              </span>
            )}
          </label>
        );
      });
  return (
    <>
      <PageHeading
        eyebrow="04 / YOUR AGENT’S TOOLKIT"
        title="A few skills. Chosen for a reason."
      >
        Jev’s picks are on by default. Switch off anything you don’t need.
      </PageHeading>
      <div className="details-section">
        <label htmlFor="skill-search">Search skills</label>
        <input
          id="skill-search"
          type="search"
          placeholder="Search names and descriptions"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(6);
            setBrowseOpen(true);
          }}
        />
        <div className="chips" role="group" aria-label="Skill categories">
          {["All", "Research", "Communication", "Files", "Data", "Dev"].map((name) => (
            <button
              key={name}
              aria-pressed={category === name}
              className={category === name ? "selected" : ""}
              onClick={() => {
                setCategory(name);
                setVisibleCount(6);
                setBrowseOpen(true);
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <p className="hint" aria-live="polite" aria-atomic="true">
          {matches.length} of {catalog.length} available skills match. Search and filters don’t change your selections.
        </p>
      </div>
      {draft.followUp && (
        <div className="follow-up">
          <Sparkles size={18} />
          <div>
            <strong>A question from Jev</strong>
            <p>{draft.followUp}</p>
            <button
              className="text-button"
              onClick={() => dispatch({ type: "navigate", step: "needs" })}
            >
              Add more detail <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
      <div className="section-label">
        <span>SUGGESTED FOR THIS AGENT</span>
        <span>{draft.selectedTools.length} selected</span>
      </div>
      <div className="tools-grid">{cards(suggested)}</div>
      {!suggested.length && (
        <p className="hint">No suggested skills match these filters. Browse the catalog below.</p>
      )}
      <details
        className="catalog-details"
        open={browseOpen}
        onToggle={(event) => setBrowseOpen(event.currentTarget.open)}
      >
        <summary>
          Add more from the catalog{" "}
          <span>{other.length} more skills · Browse all</span>
        </summary>
        {["Research", "Communication", "Files", "Data", "Dev"].map((group) => {
          const visible = other.slice(0, visibleCount).filter((skill) => skill.category === group);
          return visible.length ? <section key={group} aria-label={`${group} skills`}><h3>{group}</h3><div className="tools-grid">{cards(visible)}</div></section> : null;
        })}
        {other.length > visibleCount && (
          <button className="text-button" onClick={() => setVisibleCount((count) => count + 6)}>
            Load more skills ({other.length - visibleCount} remaining)
          </button>
        )}
        {!other.length && <p className="hint">No other skills match. Try another search or category.</p>}
      </details>
      {!matches.length && search && <MissingSkills key={search} term={search} />}
      <p className="hint">
        Showing the curated builder catalog, not the full skills.sh directory.
      </p>
      <p className="safety">
        <ShieldCheck size={17} /> These are requirements, not connected accounts
        or granted permissions. Your chosen runtime must provide each tool.
        External skills from skills.sh are not bundled or installed; restricted
        workers may not support them.
      </p>
      <div className="page-actions right">
        <Next onClick={() => dispatch({ type: "navigate", step: "details" })}>
          Add the details
        </Next>
      </div>
    </>
  );
}
const inputTypeLabels: Record<(typeof inputTypes)[number], string> = {
  folder: "A folder",
  file: "A file",
  text: "Text",
  connection: "An app connection",
};
const parseFormats = (value: string) => [
  ...new Set(
    value
      .toLowerCase()
      .split(/[\s,]+/)
      .map((format) => format.replace(/^\./, ""))
      .filter((format) => /^[a-z0-9]{1,10}$/.test(format)),
  ),
];
function FormatsField({
  formats,
  label,
  onChange,
}: {
  formats: string[];
  label: string;
  onChange: (formats: string[]) => void;
}) {
  // Keep the raw text locally so commas and spaces can be typed.
  const [raw, setRaw] = useState(formats.join(", "));
  useEffect(() => {
    if (parseFormats(raw).join() !== formats.join()) setRaw(formats.join(", "));
    // Only resync when the saved formats change from elsewhere.
  }, [formats.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label>
      {label}
      <input
        value={raw}
        placeholder="pdf, xlsx, csv"
        onChange={(e) => {
          setRaw(e.target.value);
          onChange(parseFormats(e.target.value));
        }}
      />
    </label>
  );
}
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | "";
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          role="radio"
          aria-checked={value === option.id}
          className={value === option.id ? "selected" : ""}
          onClick={() => onChange(option.id)}
        >
          {value === option.id && <Check size={13} />} {option.label}
        </button>
      ))}
    </div>
  );
}
export function DetailsPage({ draft, dispatch }: PageProps) {
  const d = draft.details;
  const choice = classifyRuntime(draft);
  const runtime = d.runtime || choice.runtime;
  const questions = pendingQuestions(draft);
  const guided = usesSkillQuestions(draft);
  const set = (patch: Partial<BuildDetails>) =>
    dispatch({ type: "details", patch });
  const setInput = (i: number, patch: Partial<BuildDetails["inputs"][number]>) =>
    set({ inputs: d.inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const files = d.dataSources
    .filter((source) => source.startsWith("files:"))
    .map((source) => source.slice(6));
  const live = d.dataSources.filter((source) => !source.startsWith("files:"));
  const toggleSource = (source: string) =>
    set({
      dataSources: d.dataSources.includes(source)
        ? d.dataSources.filter((x) => x !== source)
        : [...d.dataSources, source],
    });
  return (
    <>
      <PageHeading
        eyebrow="05 / A FEW DETAILS"
        title="What does it need to run?"
      >
        Jev filled in what it could. Answer the open questions so nothing in
        the export is a guess.
      </PageHeading>
      {questions.length > 0 && (
        <div className="follow-up" aria-label="Open questions">
          <Sparkles size={18} />
          <div>
            <strong>
              {questions.length} open question{questions.length > 1 ? "s" : ""}
            </strong>
            <ul className="question-list">
              {questions.map((q) => (
                <li key={q.field}>{q.question}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <p className="hint">{runtime === "worker" ? "Worker" : "Live Pi extension"} · {choice.signals.join(", ") || "Runs once when you request it"}.</p>
      <section className="details-section" aria-label="Selected skill permissions">
        <h3>What these skills need permission to do</h3>
        {catalog.filter((skill) => draft.selectedTools.includes(skill.id)).map((skill) => (
          <p key={skill.id}><strong>{skill.name}</strong>: {Object.entries(skill.permissions).filter(([, needed]) => needed).map(([permission]) => permission.replaceAll("_", " ")).join(", ") || "No external actions"}.</p>
        ))}
        <p className="hint">Selecting a skill does not connect an account or grant access. Sending and changing still require approval.</p>
      </section>
      {guided && (
        <fieldset className="details-section">
          <legend>A few questions</legend>
          {skillQuestions(draft).map((question) => (
            <label key={question.id}>
              {question.question}
              <input
                type={question.type === "email" ? "email" : "text"}
                maxLength={2000}
                value={d.skillAnswers[question.id] ?? question.default ?? ""}
                onChange={(event) => set({ skillAnswers: { ...d.skillAnswers, [question.id]: event.target.value } })}
              />
            </label>
          ))}
          <p className="hint">Answers are saved in the draft and exported agent. Do not enter credentials.</p>
        </fieldset>
      )}
      <details className="catalog-details">
        <summary>Advanced</summary>
      <fieldset className="details-section">
        <legend>How it runs</legend>
        <button className="text-button" onClick={() => set({ runtime: "" })}>Use automatic runtime</button>
        <Choice
          label="How it runs"
          value={choice.conflict && !d.runtime ? "" : runtime}
          options={[
            { id: "worker", label: "Answers once when I run it" },
            { id: "extension", label: "Keeps running in the terminal" },
          ]}
          onChange={(value) =>
            set({
              runtime: value,
              outputKind: value === "worker" ? "chat-message" : "widget",
              inputs:
                value === "worker" && !d.inputs.length
                  ? [{ label: "", type: "text", formats: [], required: true }]
                  : d.inputs,
            })
          }
        />
        <p className="hint">
          {choice.conflict && !d.runtime
            ? `Jev saw mixed signals (${choice.signals.join(", ")}). Pick one.`
            : `${d.runtime ? "You chose" : "Jev suggests"} ${runtime === "worker" ? "a one-shot worker: /command with arguments, one reply" : "a live extension: starts with Pi and refreshes a panel"}${!d.runtime && choice.signals.length ? `, because of ${choice.signals.join(", ")}` : ""}.`}
        </p>
      </fieldset>
      </details>
      {runtime === "worker" ? (
        !guided && <>
          <fieldset className="details-section">
            <legend>It starts with…</legend>
            <p className="hint">
              Each input becomes a command argument, in this order. The command
              checks them before any model run.
            </p>
            {d.inputs.map((input, i) => (
              <div className="input-row" key={i}>
                <label>
                  Input {i + 1}
                  <input
                    value={input.label}
                    maxLength={200}
                    placeholder={
                      input.type === "text" ? "New job description" : "Past estimates"
                    }
                    onChange={(e) => setInput(i, { label: e.target.value })}
                  />
                </label>
                <label>
                  Type of input {i + 1}
                  <select
                    value={input.type}
                    onChange={(e) =>
                      setInput(i, {
                        type: e.target.value as (typeof inputTypes)[number],
                      })
                    }
                  >
                    {inputTypes.map((type) => (
                      <option key={type} value={type}>
                        {inputTypeLabels[type]}
                      </option>
                    ))}
                  </select>
                </label>
                {input.type === "file" || input.type === "folder" ? (
                  <FormatsField
                    label={`Formats of input ${i + 1}`}
                    formats={input.formats}
                    onChange={(formats) => setInput(i, { formats })}
                  />
                ) : (
                  <span aria-hidden="true" />
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={input.required}
                    onChange={(e) => setInput(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  className="icon-button"
                  aria-label={`Remove input ${i + 1}`}
                  onClick={() =>
                    set({ inputs: d.inputs.filter((_, j) => j !== i) })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {d.inputs.length < 10 && (
              <button
                className="text-button"
                onClick={() =>
                  set({
                    inputs: [
                      ...d.inputs,
                      { label: "", type: "text", formats: [], required: true },
                    ],
                  })
                }
              >
                <Plus size={13} /> Add an input
              </button>
            )}
            <p className="hint">
              PDF, Word, Excel and PowerPoint files are read with the bundled
              extract tool. Pi’s read tool handles text files and images.
            </p>
          </fieldset>
          <fieldset className="details-section">
            <legend>It gives back…</legend>
            <Choice
              label="Result"
              value={d.outputKind === "file" ? "file" : "chat-message"}
              options={[
                { id: "chat-message", label: "A message in the chat" },
                { id: "file", label: "A Markdown file" },
              ]}
              onChange={(value) => set({ outputKind: value })}
            />
            <label htmlFor="details-template">
              Sections the result must have (one per line)
            </label>
            <textarea
              id="details-template"
              rows={4}
              maxLength={4000}
              placeholder={"Line items\nAssumptions\nConfidence range"}
              value={d.template}
              onChange={(e) => set({ template: e.target.value })}
            />
          </fieldset>
          <fieldset className="details-section">
            <legend>How it works</legend>
            <label htmlFor="details-method">Steps it follows (one per line)</label>
            <textarea
              id="details-method"
              rows={5}
              maxLength={10000}
              placeholder={"1. Find comparable past jobs\n2. Convert them to per-unit rates"}
              value={d.method}
              onChange={(e) => set({ method: e.target.value })}
            />
            <span className="hint">
              Required for analysis agents. Describe drafting, planning or
              reviewing here; those need no extra tools.
            </span>
            <Choice
              label="Missing inputs"
              value={d.conversation}
              options={[
                { id: "oneShot", label: "List gaps and assumptions in the result" },
                { id: "followUp", label: "Ask, and continue on the next run" },
              ]}
              onChange={(value) => set({ conversation: value })}
            />
            <label htmlFor="details-when">
              When should your main agent suggest it?
            </label>
            <input
              id="details-when"
              maxLength={1024}
              placeholder="Use when the user wants an estimate for a new job."
              value={d.whenToUse}
              onChange={(e) => set({ whenToUse: e.target.value })}
            />
          </fieldset>
        </>
      ) : (
        <details className="catalog-details">
        <summary>Advanced live settings</summary>
        <fieldset className="details-section">
          <legend>It watches…</legend>
          <div className="chips" role="group" aria-label="Live data sources">
            {[
              { id: "session-events", label: "Pi session activity" },
              { id: "process-list", label: "Running agent processes" },
            ].map((source) => (
              <button
                key={source.id}
                aria-pressed={live.includes(source.id)}
                className={live.includes(source.id) ? "selected" : ""}
                onClick={() => toggleSource(source.id)}
              >
                {live.includes(source.id) && <Check size={13} />} {source.label}
              </button>
            ))}
          </div>
          <label htmlFor="details-files">
            Files or folders to watch (one per line, optional)
          </label>
          <textarea
            id="details-files"
            rows={2}
            placeholder="logs/agents.log"
            value={files.join("\n")}
            onChange={(e) =>
              set({
                dataSources: [
                  ...live,
                  ...e.target.value
                    .split("\n")
                    .map((path) => path.trim())
                    .filter(Boolean)
                    .slice(0, 8)
                    .map((path) => `files:${path}`),
                ],
              })
            }
          />
          <Choice
            label="Shown as"
            value={d.outputKind === "status" ? "status" : "widget"}
            options={[
              { id: "widget", label: "A panel above the editor" },
              { id: "status", label: "A status line" },
            ]}
            onChange={(value) => set({ outputKind: value })}
          />
          <p className="hint">
            Starts with each Pi session, refreshes every few seconds and cleans
            up when the session ends. No model calls.
          </p>
        </fieldset>
        </details>
      )}
      <div className="page-actions">
        <button
          className="text-button"
          onClick={() => dispatch({ type: "reset-details" })}
        >
          <RotateCcw size={13} /> Use Jev’s suggestions
        </button>
        <Next
          disabled={questions.length > 0}
          onClick={() => dispatch({ type: "navigate", step: "review" })}
        >
          Review my agent
        </Next>
      </div>
    </>
  );
}
export function ProblemList({
  problems,
  title,
}: {
  problems: { message: string }[];
  title: string;
}) {
  if (!problems.length) return null;
  return (
    <div className="error problem-list" role="alert">
      <strong>{title}</strong>
      <ul>
        {[...new Set(problems.map((p) => p.message))].map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
export function ReviewPage({ draft, dispatch, trigger }: PageProps) {
  let spec: AgentSpec | undefined,
    failure = "";
  try {
    spec = createAgentSpec(draft, trigger);
  } catch (error) {
    failure = error instanceof Error ? error.message : "Check your answers.";
  }
  if (!spec)
    return (
      <>
        <PageHeading eyebrow="06 / READY WHEN YOU ARE" title="Almost there.">
          A few answers are still missing.
        </PageHeading>
        <ProblemList title="Before you create it" problems={[{ message: failure }]} />
        <div className="page-actions right">
          <Next onClick={() => dispatch({ type: "navigate", step: "details" })}>
            Back to the details
          </Next>
        </div>
      </>
    );
  const blocking = specProblems(spec);
  const blockingMessages = new Set(blocking.map((p) => p.message));
  const pi = exportProblems(spec, "Pi").filter(
    (p) => !blockingMessages.has(p.message),
  );
  return (
    <>
      <PageHeading
        eyebrow="06 / READY WHEN YOU ARE"
        title="Meet your newest helper."
      >
        A clear job, a useful toolkit, and you in control.
      </PageHeading>
      {usesSkillQuestions(draft) && (
        <section className="details-section" aria-label="Test availability">
          <button disabled>Send a test now</button>
          <p className="hint">Test runs are not available: this app has no connected research or email execution service. No email will be sent and no skill will be marked tested. Export to a compatible, authorized host to run it.</p>
        </section>
      )}
      <div className="review-card">
        <AgentIcon category={draft.category!} size={86} />
        <div>
          <span className="eyebrow">
            {categories.find((c) => c.id === draft.category)?.name}
          </span>
          <h2>{draft.name}</h2>
          <code>
            {spec.runtime === "worker"
              ? `/${trigger}${spec.inputs.map((x) => (x.required ? ` <${x.name}>` : ` [${x.name}]`)).join("")}`
              : `/${trigger}`}
          </code>
        </div>
      </div>
      <ProblemList title="Fix these before creating" problems={blocking} />
      <div className="review-grid">
        <section>
          <span className="eyebrow">STARTS WITH</span>
          <p>{spec.startsWith}</p>
        </section>
        <section>
          <span className="eyebrow">GIVES BACK</span>
          <p>{spec.givesBack}</p>
        </section>
      </div>
      {spec.method.length > 0 && (
        <section className="review-context">
          <span className="eyebrow">THE METHOD</span>
          <ol>
            {spec.method.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      )}
      {draft.context && (
        <section className="review-context">
          <span className="eyebrow">THE JOB</span>
          <p>{draft.context}</p>
        </section>
      )}
      <div className="review-tools">
        {spec.tools.length ? (
          spec.tools.map((tool) => (
            <span key={tool.id}>
              {catalog.find((t) => t.id === tool.id)?.name}
              {tool.requiresApproval && (
                <ShieldCheck size={14} aria-label="Requires approval" />
              )}
            </span>
          ))
        ) : (
          <p>
            {spec.runtime === "worker"
              ? "No tools needed. This agent will work from the text you provide."
              : "No model tools. This extension reads its live data sources directly."}
          </p>
        )}
      </div>
      {pi.length > 0 && (
        <div className="follow-up">
          <ShieldCheck size={18} />
          <div>
            <strong>The Pi package export will stop until you fix these</strong>
            <ul className="question-list">
              {[...new Set(pi.map((p) => p.message))].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <p className="safety">
        <ShieldCheck size={18} /> Always asks before sending messages, creating
        events, or changing records. Exported instructions are not an OS
        security sandbox.
      </p>
      <details className="spec-details">
        <summary>
          Preview the saved agent spec <span>JSON · version 3</span>
        </summary>
        <pre>{JSON.stringify(spec, null, 2)}</pre>
      </details>
      <div className="page-actions right">
        <button
          className="button primary"
          disabled={blocking.length > 0}
          onClick={() => dispatch({ type: "created", trigger })}
        >
          Create my agent <Check size={17} />
        </button>
      </div>
    </>
  );
}
