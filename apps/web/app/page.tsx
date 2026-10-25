"use client";
import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Cloud,
  Download,
  Moon,
  Plus,
  Sun,
  Upload,
  X,
} from "lucide-react";
import {
  categories,
  emptyDraft,
  parseAgentSpec,
  triggerFromName,
  uniqueTrigger,
  type AgentSpec,
  type BuildStep,
} from "@agents/spec";
import { detailsFromSpec, inputChips, outputChips, getTool } from "@agents/jev";
import { AgentIcon } from "../components/agent-icon";
import {
  CategoryPage,
  NamePage,
  NeedsPage,
  JevPage,
  ToolsPage,
  DetailsPage,
  ReviewPage,
} from "../components/build-pages";
import { InstallPage, download } from "../components/install-page";
import { fromCloud, useBuild } from "../lib/use-build";
import type { Snapshot } from "../lib/build-machine";

const LIBRARY_KEY = "agent-creations:library:v2";
type SavedAgent = { id: string; spec: AgentSpec };
const previous: Partial<Record<BuildStep, BuildStep>> = {
  name: "category",
  needs: "name",
  jev: "needs",
  tools: "needs",
  details: "tools",
  review: "details",
  install: "review",
};
export default function Home() {
  const { state, dispatch, storage, cloud, retrySave, reloadCloud } =
    useBuild();
  const [view, setView] = useState<"build" | "library">("build");
  const [library, setLibrary] = useState<SavedAgent[]>([]),
    [libraryReady, setLibraryReady] = useState(false);
  const [dark, setDark] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LIBRARY_KEY);
      if (saved)
        setLibrary(
          JSON.parse(saved).map((item: SavedAgent) => ({
            id: item.id,
            spec: parseAgentSpec(item.spec),
          })),
        );
      else {
        const legacy = localStorage.getItem("agent-creations:v1");
        if (legacy)
          setLibrary(
            JSON.parse(legacy).map((spec: unknown) => ({
              id: crypto.randomUUID(),
              spec: parseAgentSpec(spec),
            })),
          );
      }
    } catch {
      dispatch({
        type: "notice",
        message:
          "Some saved agents could not be loaded. Your old storage is unchanged; import a JSON backup to recover them.",
      });
    }
    setLibraryReady(true);
    let theme: string | null = null;
    try {
      theme = localStorage.getItem("agent-creations:theme");
    } catch {
      /* Keep the default dark blue theme when storage is blocked. */
    }
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    setDark(theme !== "light");
  }, [dispatch]);
  useEffect(() => {
    if (!libraryReady || !state.agent) return;
    const next = [
      ...library.filter((item) => item.id !== state.id),
      { id: state.id, spec: state.agent },
    ];
    setLibrary(next);
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
    } catch {
      dispatch({
        type: "notice",
        message:
          "Your agent is ready, but device storage is unavailable. Download Agent JSON to keep it.",
      });
    }
    // Save on creation or a canonical cloud update, not on every render.
  }, [state.agent, state.id, libraryReady, dispatch]);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        document
          .querySelector<HTMLElement>("[data-step-heading]")
          ?.focus({ preventScroll: true }),
      reduced ? 0 : 400,
    );
    return () => clearTimeout(timer);
  }, [state.draft.step, view, reduced]);
  const base = triggerFromName(state.draft.name);
  const suffix = state.trigger.match(/-(\d+)$/);
  const allocated =
    state.trigger === base ||
    (!!suffix &&
      Number(suffix[1]) >= 2 &&
      state.trigger ===
        base.slice(0, 64 - suffix[0].length).replace(/-$/, "") + suffix[0]);
  const trigger = allocated
    ? state.trigger
    : uniqueTrigger(
        state.draft.name,
        library
          .filter((item) => item.id !== state.id)
          .map((item) => item.spec.trigger),
      );
  const props = { draft: state.draft, dispatch, trigger };
  const selectedCategory = categories.find(
    (c) => c.id === state.draft.category,
  );
  const notify = (message: string) => dispatch({ type: "notice", message });
  const openAgent = async (spec: AgentSpec, id: string, imported = false) => {
    if (cloud === "enabled" && !imported) {
      try {
        const response = await fetch(`/api/agent-builds/${id}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          dispatch({
            type: "restore",
            snapshot: fromCloud(await response.json()),
          });
          setView("build");
          return;
        }
      } catch {
        notify(
          "Cloud version unavailable. Opening the local copy without overwriting the server.",
        );
      }
    }
    const restored: Snapshot = {
      id,
      revision: 0,
      trigger: spec.trigger,
      agent: spec,
      draft: {
        ...emptyDraft,
        category: spec.category,
        name: spec.name,
        inputChips: spec.needs.inputChips.filter((id) =>
          inputChips.some((chip) => chip.id === id),
        ),
        outputChips: spec.needs.outputChips.filter((id) =>
          outputChips.some((chip) => chip.id === id),
        ),
        context: spec.needs.context || spec.instructions,
        selectedTools: spec.tools.map((t) => t.id).filter((id) => getTool(id)),
        details: detailsFromSpec(spec),
        step: "install",
      },
    };
    dispatch({ type: "restore", snapshot: restored });
    setView("build");
  };
  const importAgent = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error("Too large");
      await openAgent(
        parseAgentSpec(JSON.parse(await file.text())),
        crypto.randomUUID(),
        true,
      );
      notify(
        "Imported agent. Existing instructions are preserved in the download. Editing it rebuilds the spec from this flow.",
      );
    } catch {
      notify(
        "Import failed. Choose a valid Agent Spec v1, v2 or v3 JSON file under 100 KB.",
      );
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  const startNew = () => {
    if (
      state.draft.category &&
      !state.agent &&
      !window.confirm(
        "Start a new build? This replaces the active local draft. Cloud-saved drafts remain on the server.",
      )
    )
      return;
    dispatch({ type: "new", id: crypto.randomUUID() });
    setView("build");
  };
  const toggleTheme = () => {
    const theme = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("agent-creations:theme", theme);
    } catch {
      /* Theme still works for this session. */
    }
  };
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="builder">
        <header className="topbar">
          <a className="brand" href="/" aria-label="Agent Creations home">
            <span className="brand-mark">
              <Box size={21} />
            </span>
            agent<span>creations</span>
            <small>LAB</small>
          </a>
          <nav aria-label="Main">
            <button
              className={view === "build" ? "active" : ""}
              onClick={() => setView("build")}
            >
              The workshop
            </button>
            <button
              className={view === "library" ? "active" : ""}
              onClick={() => setView("library")}
            >
              My agents <span>{library.length}</span>
            </button>
          </nav>
          <div className="top-actions">
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="button small"
              onClick={startNew}
              disabled={!state.ready}
            >
              <Plus size={15} /> New agent
            </button>
          </div>
        </header>
        <main>
          <div className="workshop-intro">
            <div>
              <span className="eyebrow">
                <span className="live-dot" /> SMALL AGENTS. MORE POSSIBILITY.
              </span>
              <h2>
                A little help. <em>Made by you.</em>
              </h2>
            </div>
            <button
              className="text-button"
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={14} /> Import an agent
            </button>
          </div>
          <input
            className="sr-only"
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="Import agent JSON"
            onChange={(e) => void importAgent(e.target.files?.[0])}
          />
          {state.notice && (
            <div role="status" className="notice">
              {state.notice}
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => notify("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {view === "library" ? (
            <section className="library">
              <div className="page-heading">
                <span className="eyebrow">YOUR LITTLE TEAM</span>
                <h1>My agents</h1>
                <p>
                  Created agents on this device. Download JSON for a portable
                  backup.
                </p>
              </div>
              {!library.length && (
                <div className="empty">
                  <Box size={38} />
                  <h2>Your team starts with one.</h2>
                  <button
                    className="button primary"
                    onClick={() => setView("build")}
                  >
                    Go to the workshop <ArrowRight size={15} />
                  </button>
                </div>
              )}
              <div className="library-grid">
                {library.map((item) => (
                  <article className="saved-card" key={item.id}>
                    <AgentIcon category={item.spec.category} />
                    <h2>{item.spec.name}</h2>
                    <code>/{item.spec.trigger}</code>
                    <p>{item.spec.description}</p>
                    <div className="actions">
                      <button
                        className="button"
                        onClick={() => void openAgent(item.spec, item.id)}
                      >
                        Open agent <ArrowRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Download ${item.spec.name} JSON`}
                        onClick={() =>
                          download(
                            `${item.spec.trigger}.json`,
                            JSON.stringify(item.spec, null, 2),
                            "application/json",
                          )
                        }
                      >
                        <Download size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className="workshop" aria-label="Agent builder">
              <div className="build-header">
                <div className="build-identity">
                  {selectedCategory && (
                    <motion.span
                      layoutId={`avatar-${selectedCategory.id}`}
                      transition={{ duration: reduced ? 0 : 0.36 }}
                    >
                      <AgentIcon
                        category={selectedCategory.id}
                        size={42}
                        accent={selectedCategory.color}
                      />
                    </motion.span>
                  )}
                  {(state.draft.name || selectedCategory) && (
                    <div>
                      {state.draft.name && <strong>{state.draft.name}</strong>}
                      {selectedCategory && <span>{selectedCategory.name}</span>}
                    </div>
                  )}
                </div>
                <div className="save-status">
                  <Cloud size={14} />
                  <span aria-live="polite">{storage}</span>
                  {cloud === "blocked" && (
                    <>
                      <button className="text-button" onClick={retrySave}>
                        Retry
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          if (
                            confirm(
                              "Replace the local draft with the last cloud version? Unsynced changes will be discarded.",
                            )
                          )
                            void reloadCloud();
                        }}
                      >
                        Load cloud copy
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="page-toolbar">
                {previous[state.draft.step] ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      dispatch({
                        type: "navigate",
                        step: previous[state.draft.step]!,
                      })
                    }
                  >
                    <ArrowLeft size={14} /> Back
                  </button>
                ) : (
                  <span className="eyebrow">THE WORKSHOP</span>
                )}
                <span className="hint">
                  {state.draft.step === "install"
                    ? "Build once. Bring it anywhere."
                    : "One clear job. A useful result."}
                </span>
              </div>
              {state.error && (
                <div className="error" role="alert">
                  {state.error}
                </div>
              )}
              <div className="page-container">
                <AnimatePresence
                  mode="wait"
                  initial={false}
                  custom={state.direction}
                >
                  <motion.div
                    key={state.ready ? state.draft.step : "loading"}
                    custom={state.direction}
                    variants={{
                      enter: (direction: number) => ({
                        x: reduced ? 0 : direction * 32,
                        opacity: reduced ? 1 : 0,
                      }),
                      center: { x: 0, opacity: 1 },
                      exit: (direction: number) => ({
                        x: reduced ? 0 : direction * -32,
                        opacity: reduced ? 1 : 0,
                      }),
                    }}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      duration: reduced ? 0 : 0.18,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    {!state.ready ? (
                      <p className="loading">Restoring your workshop…</p>
                    ) : state.draft.step === "category" ? (
                      <CategoryPage {...props} />
                    ) : state.draft.step === "name" ? (
                      <NamePage {...props} />
                    ) : state.draft.step === "needs" ? (
                      <NeedsPage {...props} />
                    ) : state.draft.step === "jev" ? (
                      <JevPage {...props} />
                    ) : state.draft.step === "tools" ? (
                      <ToolsPage {...props} />
                    ) : state.draft.step === "details" ? (
                      <DetailsPage {...props} />
                    ) : state.draft.step === "review" ? (
                      <ReviewPage {...props} />
                    ) : state.agent ? (
                      <InstallPage
                        agent={state.agent}
                        notify={notify}
                        onEdit={() =>
                          dispatch({ type: "navigate", step: "details" })
                        }
                      />
                    ) : (
                      <ReviewPage {...props} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </section>
          )}
          <section className="principles">
            <div>
              <span>01</span>
              <h3>Yours from the start.</h3>
              <p>Your purpose. Your instructions. Your model.</p>
            </div>
            <div>
              <span>02</span>
              <h3>Small is a superpower.</h3>
              <p>The best agents know what they’re here for.</p>
            </div>
            <div>
              <span>03</span>
              <h3>Take it with you.</h3>
              <p>Open formats. The tools you already use.</p>
            </div>
          </section>
          <footer>
            <span>✦ agentcreations</span>
            <span>A little less busywork. A little more possibility.</span>
            <span>BUILT TO BE YOURS ↗</span>
          </footer>
        </main>
      </LayoutGroup>
    </MotionConfig>
  );
}
