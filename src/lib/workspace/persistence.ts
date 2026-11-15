/**
 * Browser-local persistence of the workspace in IndexedDB. Storage can be
 * missing or blocked (private windows, disabled site data); every access is
 * guarded and the playground keeps working in memory.
 */

import { createStore, del, get, set, type UseStore } from "idb-keyval";

import type { LogEntry } from "./log";
import { parseWorkspaceDoc, type WorkspaceDoc } from "./model";

export interface UiPrefs {
  selectedContract: string;
  selectedFunction: string;
  inspectContract: string;
  inspectView: "source" | "ir";
  showSystemContracts: boolean;
  showProtectedKeys: boolean;
}

export interface LocalWorkspace {
  doc: WorkspaceDoc;
  ui: UiPrefs;
  log: LogEntry[];
  /** The engine's own snapshot of the chain store (trusted, written by this app). */
  snapshot: string | null;
}

export interface WorkspaceStore {
  load(): Promise<LocalWorkspace | null>;
  save(workspace: LocalWorkspace): Promise<boolean>;
  clear(): Promise<void>;
  /** False once the browser refused storage. */
  available(): boolean;
}

const KEY = "workspace-v1";

export function defaultUiPrefs(): UiPrefs {
  return {
    selectedContract: "",
    selectedFunction: "",
    inspectContract: "",
    inspectView: "source",
    showSystemContracts: false,
    showProtectedKeys: false,
  };
}

export function createWorkspaceStore(databaseName = "xian-playground"): WorkspaceStore {
  let store: UseStore | null = null;
  let ok = true;
  const idb = (): UseStore => (store ??= createStore(databaseName, "workspace"));
  const guard = async <T,>(action: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await action();
    } catch {
      ok = false;
      return fallback;
    }
  };
  return {
    load: () => guard(async () => parseLocal(await get(KEY, idb())), null),
    save: (workspace) => guard(async () => (await set(KEY, workspace, idb()), true), false),
    clear: () => guard(() => del(KEY, idb()), undefined),
    available: () => ok,
  };
}

function parseLocal(value: unknown): LocalWorkspace | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Partial<LocalWorkspace>;
  try {
    return {
      doc: parseWorkspaceDoc(record.doc),
      ui: sanitizeUi({ ...defaultUiPrefs(), ...pickUi(record.ui) }),
      log: Array.isArray(record.log) ? record.log : [],
      snapshot: typeof record.snapshot === "string" ? record.snapshot : null,
    };
  } catch {
    return null;
  }
}

function sanitizeUi(ui: UiPrefs): UiPrefs {
  return ui.inspectView === "ir" ? ui : { ...ui, inspectView: "source" };
}

function pickUi(value: unknown): Partial<UiPrefs> {
  if (typeof value !== "object" || value === null) return {};
  const defaults = defaultUiPrefs();
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, entry]) => key in defaults && typeof entry === typeof defaults[key as keyof UiPrefs],
    ),
  ) as Partial<UiPrefs>;
}
