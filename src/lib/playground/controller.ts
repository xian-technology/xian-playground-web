/**
 * The playground's application logic: one writer of the UI state, driven by
 * user actions, talking to the engine and to browser storage. React reads it
 * through `subscribe`/`getState` (useSyncExternalStore).
 */

import { parseField } from "@/lib/contract/kwargs";
import { extractMethods, type ContractMethods } from "@/lib/contract/methods";
import { contractNameError } from "@/lib/contract/names";
import type { ExecutionOutcome, PlaygroundEngine, StateEntry } from "@/lib/engine/types";
import { parseInteger } from "@/lib/values/numbers";
import { appendLog, summarizeStateChanges, type LogEntry, type LogInput } from "@/lib/workspace/log";
import {
  defaultWorkspace,
  type EnvironmentSettings,
  type MeteringSettings,
  type WorkspaceDoc,
} from "@/lib/workspace/model";
import { defaultUiPrefs, type UiPrefs, type WorkspaceStore } from "@/lib/workspace/persistence";

import { planStateEdit, restoreWrites, splitKey, toPortableContracts, type ContractMeta } from "./state-doc";

export interface ContractView {
  name: string;
  source: string;
  vmIrJson: string;
  methods: ContractMethods;
}

export interface RunRecord {
  kind: "deploy" | "call";
  contract: string;
  function: string;
  /** Wire JSON text of the kwargs (or constructor args) that were sent. */
  kwargs: string;
  outcome: ExecutionOutcome;
  at: string;
}

export type Busy = "deploy" | "call" | "state" | "workspace" | null;

export interface PlaygroundState {
  phase: "loading" | "ready" | "failed";
  loadError: string | null;
  doc: WorkspaceDoc;
  ui: UiPrefs;
  log: LogEntry[];
  contracts: ContractView[];
  state: StateEntry[];
  lastRun: RunRecord | null;
  busy: Busy;
  storageAvailable: boolean;
}

export type Notify = (level: "success" | "info" | "warning" | "error", message: string) => void;

export interface ControllerDeps {
  engine: PlaygroundEngine;
  store: WorkspaceStore;
  notify: Notify;
}

const EDITOR_SAVE_DELAY_MS = 400;

export class PlaygroundController {
  private current: PlaygroundState = {
    phase: "loading",
    loadError: null,
    doc: defaultWorkspace(),
    ui: defaultUiPrefs(),
    log: [],
    contracts: [],
    state: [],
    lastRun: null,
    busy: null,
    storageAvailable: true,
  };
  private listeners = new Set<() => void>();
  private snapshot: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PlaygroundState => this.current;

  private set(patch: Partial<PlaygroundState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener();
  }

  private log(input: LogInput): void {
    this.set({ log: appendLog(this.current.log, input) });
  }

  private meta(): ContractMeta[] {
    return this.current.doc.contracts.map(({ name, source, constructorKwargs }) => ({ name, source, constructorKwargs }));
  }

  /** Load the saved workspace (or start fresh) and bring the engine to it. */
  async init(): Promise<void> {
    try {
      const saved = await this.deps.store.load();
      if (saved) {
        this.set({ doc: saved.doc, ui: saved.ui, log: saved.log });
        if (saved.snapshot !== null) {
          await this.deps.engine.importSnapshot(saved.snapshot);
          this.snapshot = saved.snapshot;
        } else {
          await this.restoreContracts(saved.doc);
        }
      }
      await this.refresh();
      this.set({ phase: "ready", storageAvailable: this.deps.store.available() });
    } catch (error) {
      this.set({ phase: "failed", loadError: message(error) });
    }
  }

  /** Recover from a saved workspace that cannot be loaded: forget it and start over. */
  async startFresh(): Promise<void> {
    await this.deps.store.clear();
    await this.deps.engine.reset();
    this.snapshot = null;
    this.set({ doc: defaultWorkspace(), ui: defaultUiPrefs(), log: [], lastRun: null, loadError: null });
    await this.refresh();
    this.set({ phase: "ready" });
  }

  private async refresh(): Promise<void> {
    const [contracts, state] = await Promise.all([this.deps.engine.contracts(), this.deps.engine.state()]);
    this.set({
      contracts: contracts.map((contract) => ({ ...contract, methods: extractMethods(contract.vmIrJson) })),
      state,
    });
  }

  private async persist(withSnapshot: boolean): Promise<void> {
    if (withSnapshot) this.snapshot = await this.deps.engine.exportSnapshot();
    const { doc, ui, log } = this.current;
    const saved = await this.deps.store.save({ doc, ui, log, snapshot: this.snapshot });
    if (!saved && this.current.storageAvailable) this.set({ storageAvailable: false });
  }

  private async exclusive<T>(busy: Exclude<Busy, null>, work: () => Promise<T>): Promise<T | undefined> {
    if (this.current.busy) return undefined;
    this.set({ busy });
    try {
      return await work();
    } finally {
      this.set({ busy: null });
    }
  }

  setCode(code: string): void {
    this.set({ doc: { ...this.current.doc, editor: { ...this.current.doc.editor, code } } });
    this.scheduleSave();
  }

  setContractName(contractName: string): void {
    this.set({ doc: { ...this.current.doc, editor: { ...this.current.doc.editor, contractName } } });
    this.scheduleSave();
  }

  setUi(patch: Partial<UiPrefs>): void {
    this.set({ ui: { ...this.current.ui, ...patch } });
    this.scheduleSave();
  }

  /** Save now (Ctrl/Cmd+S); edits are also saved automatically. */
  async saveNow(): Promise<boolean> {
    this.cancelSave();
    await this.persist(false);
    return this.current.storageAvailable;
  }

  private scheduleSave(): void {
    this.cancelSave();
    this.saveTimer = setTimeout(() => void this.persist(false), EDITOR_SAVE_DELAY_MS);
  }

  private cancelSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  /** Deploy the editor's contract. `constructorKwargs` is wire JSON object text. */
  async deploy(constructorKwargs: string): Promise<ExecutionOutcome | undefined> {
    return this.exclusive("deploy", async () => {
      const { editor, environment, metering } = this.current.doc;
      const name = editor.contractName.trim();
      const nameError = contractNameError(name, environment.signer);
      if (nameError) {
        this.deps.notify("error", nameError);
        return undefined;
      }
      const outcome = await this.deps.engine.deploy({
        signer: environment.signer,
        name,
        source: editor.code,
        constructorKwargs,
        environment,
        metering,
      });
      this.set({ lastRun: { kind: "deploy", contract: name, function: "", kwargs: constructorKwargs, outcome, at: new Date().toISOString() } });
      if (outcome.ok) {
        const contracts = [
          ...this.current.doc.contracts.filter((contract) => contract.name !== name),
          { name, source: editor.code, constructorKwargs, state: [] },
        ];
        this.set({
          doc: { ...this.current.doc, contracts },
          ui: { ...this.current.ui, selectedContract: name, inspectContract: name, selectedFunction: "" },
        });
        this.log({ level: "success", action: "deploy", message: `Deployed ${name}.`, detail: chiDetail(outcome) });
        this.deps.notify("success", `Deployed ${name}.`);
      } else {
        this.log({ level: "error", action: "deploy", message: `Deploy of ${name} failed: ${outcome.error ?? ""}` });
        this.deps.notify("error", `Deploy failed: ${outcome.error ?? "unknown error"}`);
      }
      await this.refresh();
      await this.persist(true);
      return outcome;
    });
  }

  async call(contract: string, fn: string, kwargs: string): Promise<ExecutionOutcome | undefined> {
    return this.exclusive("call", async () => {
      const { environment, metering } = this.current.doc;
      const outcome = await this.deps.engine.call({ signer: environment.signer, contract, function: fn, kwargs, environment, metering });
      this.set({ lastRun: { kind: "call", contract, function: fn, kwargs, outcome, at: new Date().toISOString() } });
      const detail = `Kwargs: ${kwargs}\n${outcome.ok ? `Result: ${outcome.result ?? "null"}` : `Error: ${outcome.error ?? ""}`}\n${chiDetail(outcome)}`;
      if (outcome.ok) {
        this.log({ level: "success", action: "execute", message: `Ran ${contract}.${fn}.`, detail });
      } else {
        this.log({ level: "error", action: "execute", message: `${contract}.${fn} failed: ${outcome.error ?? ""}`, detail });
        this.deps.notify("error", outcome.error ?? "The call failed.");
      }
      await this.refresh();
      await this.persist(true);
      return outcome;
    });
  }

  /** Validate and apply environment fields; returns per-field error messages. */
  async updateEnvironment(patch: Partial<EnvironmentSettings>, meteringPatch: Partial<MeteringSettings> = {}): Promise<Record<string, string>> {
    const environment = { ...this.current.doc.environment, ...patch };
    const metering = { ...this.current.doc.metering, ...meteringPatch };
    const errors = environmentErrors(environment, metering);
    if (Object.keys(errors).length) return errors;
    const before = { ...this.current.doc.environment, chiLimit: this.current.doc.metering.chiLimit, metering: String(this.current.doc.metering.enabled) };
    this.set({ doc: { ...this.current.doc, environment, metering } });
    const after = { ...environment, chiLimit: metering.chiLimit, metering: String(metering.enabled) };
    this.log({ level: "info", action: "environment", message: "Environment updated.", detail: summarizeStateChanges(before, after) });
    await this.persist(false);
    return {};
  }

  async editState(editedText: string): Promise<boolean> {
    const result = await this.exclusive("state", async () => {
      const deployed = this.current.contracts.map((contract) => contract.name);
      let writes;
      try {
        writes = planStateEdit(this.current.state, deployed, editedText);
      } catch (error) {
        this.deps.notify("error", message(error));
        return false;
      }
      const before = Object.fromEntries(this.current.state.map((entry) => [entry.key, entry.value]));
      await this.deps.engine.writeState(writes);
      await this.refresh();
      const after = Object.fromEntries(this.current.state.map((entry) => [entry.key, entry.value]));
      this.log({ level: "success", action: "state_edit", message: "State updated from the editor.", detail: summarizeStateChanges(before, after) });
      this.deps.notify("success", writes.length ? "State updated." : "No changes to save.");
      await this.persist(true);
      return true;
    });
    return result ?? false;
  }

  async removeContract(name: string): Promise<void> {
    await this.exclusive("state", async () => {
      await this.deps.engine.removeContract(name);
      this.set({ doc: { ...this.current.doc, contracts: this.current.doc.contracts.filter((contract) => contract.name !== name) } });
      await this.refresh();
      this.log({ level: "success", action: "remove_contract", message: `Removed ${name}.` });
      this.deps.notify("success", `Removed ${name}.`);
      await this.persist(true);
    });
  }

  /** Start over: empty chain, default editor and environment. The log is kept. */
  async resetWorkspace(): Promise<void> {
    await this.exclusive("workspace", async () => {
      await this.deps.engine.reset();
      this.set({ doc: defaultWorkspace(), ui: defaultUiPrefs(), lastRun: null });
      await this.refresh();
      this.log({ level: "success", action: "reset", message: "Workspace reset: all contracts and state cleared." });
      this.deps.notify("success", "Workspace reset.");
      await this.persist(true);
    });
  }

  clearLog(): void {
    this.set({ log: [] });
    void this.persist(false);
  }

  /** The portable workspace (export file, share link). */
  exportDoc(): WorkspaceDoc {
    return { ...this.current.doc, contracts: toPortableContracts(this.meta(), this.current.state) };
  }

  /**
   * Replace the workspace with an imported one (file or share link): redeploy
   * every contract from source in its original order, then restore its
   * public state. Any failure rolls the chain back to where it was.
   */
  async importDoc(doc: WorkspaceDoc, origin: string): Promise<boolean> {
    const result = await this.exclusive("workspace", async () => {
      const rollback = await this.deps.engine.exportSnapshot();
      const previous = this.current.doc;
      try {
        await this.deps.engine.reset();
        await this.restoreContracts(doc);
      } catch (error) {
        await this.deps.engine.importSnapshot(rollback);
        this.set({ doc: previous });
        this.log({ level: "error", action: "import", message: `Could not open the ${origin}: ${message(error)}` });
        this.deps.notify("error", `Could not open the ${origin}: ${message(error)}`);
        return false;
      }
      this.set({ doc: { ...doc, contracts: doc.contracts.map((contract) => ({ ...contract, state: [] })) }, ui: defaultUiPrefs(), lastRun: null });
      await this.refresh();
      this.log({ level: "success", action: "import", message: `Opened the ${origin} (${doc.contracts.length} contracts).` });
      this.deps.notify("success", `Opened the ${origin}.`);
      await this.persist(true);
      return true;
    });
    return result ?? false;
  }

  private async restoreContracts(doc: WorkspaceDoc): Promise<void> {
    const { environment, metering } = doc;
    for (const contract of doc.contracts) {
      const outcome = await this.deps.engine.deploy({
        signer: environment.signer,
        name: contract.name,
        source: contract.source,
        constructorKwargs: contract.constructorKwargs,
        environment,
        metering,
      });
      if (!outcome.ok) throw new Error(`${contract.name}: ${outcome.error ?? "deploy failed"}`);
      const state = (await this.deps.engine.state()).filter((entry) => splitKey(entry.key).contract === contract.name);
      await this.deps.engine.writeState(restoreWrites(contract.name, contract.state, state));
    }
    this.set({ doc: { ...this.current.doc, contracts: doc.contracts.map((contract) => ({ ...contract, state: [] })) } });
  }
}

function chiDetail(outcome: ExecutionOutcome): string {
  return outcome.chiUsed ? `Chi used: ${outcome.chiUsed}` : "";
}

export function environmentErrors(environment: EnvironmentSettings, metering: MeteringSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  if (environment.signer.trim() === "") errors.signer = "Enter a signer.";
  if (environment.now.trim() !== "") {
    try {
      parseField("datetime", environment.now);
    } catch (error) {
      errors.now = message(error);
    }
  }
  if (environment.blockNum.trim() !== "") {
    try {
      parseInteger(environment.blockNum.trim());
    } catch {
      errors.blockNum = "Enter a whole number.";
    }
  }
  if (metering.chiLimit.trim() !== "") {
    try {
      const budget = parseInteger(metering.chiLimit.trim());
      if (budget <= 0n || budget > 1_000_000n) throw new RangeError();
    } catch {
      errors.chiLimit = "Enter a whole number from 1 to 1,000,000, or leave empty for the VM ceiling.";
    }
  }
  return errors;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
