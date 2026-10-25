"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import { parseAgentSpec } from "@agents/spec";
import {
  buildReducer,
  initialState,
  snapshot,
  snapshotSchema,
  type Snapshot,
} from "./build-machine";
export const DRAFT_KEY = "agent-creations:build:v2";
export function fromCloud(row: {
  id: string;
  revision: number;
  trigger: string | null;
  draft: unknown;
  spec: unknown;
}): Snapshot {
  return snapshotSchema.parse({
    id: row.id,
    revision: row.revision,
    trigger: row.trigger || "",
    draft: row.draft,
    agent: row.spec ? parseAgentSpec(row.spec) : null,
  });
}
export function useBuild() {
  const [state, dispatch] = useReducer(buildReducer, initialState);
  const [storage, setStorage] = useState("Starting a new build…");
  const [cloud, setCloud] = useState<
    "checking" | "local" | "enabled" | "blocked"
  >("checking");
  const [retry, setRetry] = useState(0);
  const [localError, setLocalError] = useState(false);
  const latest = useRef(state);
  latest.current = state;
  const revisions = useRef(new Map<string, number>());
  const queue = useRef(Promise.resolve());
  const blocked = useRef(false);
  const lastStep = useRef("");
  useEffect(() => {
    let active = true;
    // Opening or refreshing the page always starts at step one.
    dispatch({ type: "new", id: crypto.randomUUID() });
    void fetch("/api/agent-builds", {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          setCloud("enabled");
          return;
        }
        if (!response.ok) throw new Error("Cloud connection unavailable");
        const result = await response.json();
        if (!active) return;
        setCloud(result.configured ? "enabled" : "local");
      })
      .catch(() => {
        if (active) {
          setCloud("blocked");
          setStorage("Cloud unavailable · local recovery copy only");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!state.ready) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot(state)));
      setLocalError(false);
    } catch {
      setLocalError(true);
    }
  }, [state]);
  useEffect(() => {
    if (!state.ready) return;
    if (cloud === "local") {
      setStorage("Saved on this device · cloud not configured");
      return;
    }
    if (cloud !== "enabled" || blocked.current) return;
    const current = snapshot(state);
    const delay = lastStep.current === state.draft.step ? 450 : 0;
    lastStep.current = state.draft.step;
    setStorage("Saving draft…");
    const timer = setTimeout(() => {
      queue.current = queue.current.then(async () => {
        if (blocked.current || latest.current.id !== current.id) return;
        const revision = Math.max(
          revisions.current.get(current.id) ?? 0,
          current.revision,
        );
        try {
          const response = await fetch(
            revision ? `/api/agent-builds/${current.id}` : "/api/agent-builds",
            {
              method: revision ? "PATCH" : "POST",
              headers: { "Content-Type": "application/json" },
              signal: AbortSignal.timeout(10000),
              body: JSON.stringify({
                ...(revision ? {} : { id: current.id }),
                draft: current.draft,
                revision,
                complete: current.draft.step === "install" && !!current.agent,
              }),
            },
          );
          const result = await response.json();
          if (!response.ok) {
            if (response.status === 409 || response.status === 401) {
              blocked.current = true;
              setCloud("blocked");
            }
            throw new Error(result.error || "Cloud save failed.");
          }
          const saved = fromCloud(result);
          revisions.current.set(saved.id, saved.revision);
          dispatch({
            type: "synced",
            id: saved.id,
            revision: saved.revision,
            trigger:
              latest.current.draft.name === current.draft.name
                ? saved.trigger
                : latest.current.trigger,
            agent: latest.current.draft === current.draft ? saved.agent : null,
          });
          if (latest.current.id === saved.id)
            setStorage("Saved to cloud · local recovery copy kept");
        } catch (error) {
          blocked.current = true;
          setCloud("blocked");
          setStorage(
            `${error instanceof Error ? error.message : "Cloud save failed."} Local recovery copy kept.`,
          );
        }
      });
    }, delay);
    return () => clearTimeout(timer);
    // Metadata responses must not enqueue another save.
  }, [state.id, state.draft, state.ready, cloud, retry]);
  const retrySave = () => {
    blocked.current = false;
    setCloud("enabled");
    setRetry((x) => x + 1);
  };
  const reloadCloud = async () => {
    try {
      const response = await fetch(`/api/agent-builds/${state.id}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new Error(
          "Could not load the cloud draft. Your local copy is unchanged.",
        );
      const restored = fromCloud(await response.json());
      revisions.current.set(restored.id, restored.revision);
      blocked.current = false;
      setCloud("enabled");
      dispatch({ type: "restore", snapshot: restored });
    } catch (error) {
      dispatch({
        type: "error",
        message: error instanceof Error ? error.message : "Cloud unavailable.",
      });
    }
  };
  return {
    state,
    dispatch,
    storage: localError
      ? cloud === "enabled"
        ? "Device recovery storage unavailable · cloud sync enabled"
        : "Device storage unavailable · download JSON to keep your work"
      : storage,
    cloud,
    retrySave,
    reloadCloud,
  };
}
