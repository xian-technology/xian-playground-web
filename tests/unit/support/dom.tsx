import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";

import { ControllerContext } from "@/components/playground/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CallRequest, DeployRequest, ExecutionOutcome, PlaygroundEngine, StateEntry, StateWrite } from "@/lib/engine/types";
import { PlaygroundController, type Notify } from "@/lib/playground/controller";
import type { LocalWorkspace, WorkspaceStore } from "@/lib/workspace/persistence";

/** jsdom lacks a few browser APIs Radix and the layout use. */
export function installDomShims(): void {
  class ResizeObserverShim {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverShim as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) =>
    ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, onchange: null }) as unknown as MediaQueryList) as typeof window.matchMedia;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}

/** An in-memory engine double: deploy stores `treasury = 1000`, calls echo their kwargs. */
export class MemoryEngine implements PlaygroundEngine {
  store = new Map<string, string>();
  constructor(private readonly ir = '{"functions":[]}') {}
  private ok(result = "null"): ExecutionOutcome {
    return { ok: true, rejected: false, result, error: null, chiUsed: 10, writes: [], events: [] };
  }
  async deploy(request: DeployRequest) {
    this.store.set(`${request.name}.__code__`, JSON.stringify(request.source));
    this.store.set(`${request.name}.balances:treasury`, "1000");
    return this.ok();
  }
  async call(request: CallRequest) {
    return this.ok(request.kwargs);
  }
  async contracts() {
    return [...this.store.keys()]
      .filter((key) => key.endsWith(".__code__"))
      .map((key) => ({ name: key.split(".")[0]!, source: "", vmIrJson: this.ir }));
  }
  async state(): Promise<StateEntry[]> {
    return [...this.store].sort().map(([key, value]) => ({ key, value }));
  }
  async writeState(writes: StateWrite[]) {
    for (const { key, value } of writes) {
      if (value === null) this.store.delete(key);
      else this.store.set(key, value);
    }
  }
  async removeContract(name: string) {
    for (const key of [...this.store.keys()]) if (key.startsWith(`${name}.`)) this.store.delete(key);
  }
  async exportSnapshot() {
    return JSON.stringify([...this.store]);
  }
  async importSnapshot(snapshot: string) {
    this.store = new Map(JSON.parse(snapshot) as [string, string][]);
  }
  async reset() {
    this.store.clear();
  }
}

export class MemoryStore implements WorkspaceStore {
  saved: LocalWorkspace | null = null;
  async load() {
    return this.saved;
  }
  async save(workspace: LocalWorkspace) {
    this.saved = workspace;
    return true;
  }
  async clear() {
    this.saved = null;
  }
  available() {
    return true;
  }
}

export async function startController(engine: PlaygroundEngine = new MemoryEngine(), notify: Notify = () => {}) {
  const controller = new PlaygroundController({ engine, store: new MemoryStore(), notify });
  await controller.init();
  return controller;
}

export function renderWith(controller: PlaygroundController, ui: ReactNode): RenderResult {
  return render(
    <ControllerContext.Provider value={controller}>
      <TooltipProvider>{ui}</TooltipProvider>
    </ControllerContext.Provider>,
  );
}
