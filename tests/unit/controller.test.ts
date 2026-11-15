import { describe, expect, it } from "vitest";

import type { CallRequest, DeployRequest, ExecutionOutcome, PlaygroundEngine, StateEntry, StateWrite } from "@/lib/engine/types";
import { PlaygroundController, type Notify } from "@/lib/playground/controller";
import { defaultWorkspace, type WorkspaceDoc } from "@/lib/workspace/model";
import type { LocalWorkspace, WorkspaceStore } from "@/lib/workspace/persistence";

const IR = JSON.stringify({ functions: [{ name: "transfer", visibility: "export", docstring: null, parameters: [] }] });

/** A toy chain: deploy seeds `__code__` and `treasury`, `fail` functions fail, `spend` writes. */
class ToyEngine implements PlaygroundEngine {
  store = new Map<string, string>();
  deploys: DeployRequest[] = [];
  calls: CallRequest[] = [];
  failDeployOf = "";
  private ok(writes: StateWrite[] = [], result = "null"): ExecutionOutcome {
    return { ok: true, rejected: false, result, error: null, chiUsed: 42, writes, events: [] };
  }
  private fail(error: string): ExecutionOutcome {
    return { ok: false, rejected: false, result: null, error, chiUsed: 7, writes: [], events: [] };
  }
  async deploy(request: DeployRequest) {
    this.deploys.push(request);
    if (request.name === this.failDeployOf) return this.fail("syntax error");
    this.store.set(`${request.name}.__code__`, JSON.stringify(request.source));
    this.store.set(`${request.name}.balances:treasury`, "1000");
    return this.ok();
  }
  async call(request: CallRequest) {
    this.calls.push(request);
    if (request.function === "fail") return this.fail("Insufficient balance.");
    this.store.set(`${request.contract}.balances:bob`, "25");
    return this.ok([{ key: `${request.contract}.balances:bob`, value: "25" }], "25");
  }
  async contracts() {
    return [...this.store.keys()]
      .filter((key) => key.endsWith(".__code__"))
      .map((key) => ({ name: key.split(".")[0]!, source: JSON.parse(this.store.get(key)!) as string, vmIrJson: IR }));
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

class MemoryStore implements WorkspaceStore {
  saved: LocalWorkspace | null = null;
  constructor(initial: LocalWorkspace | null = null) {
    this.saved = initial;
  }
  async load() {
    return this.saved;
  }
  async save(workspace: LocalWorkspace) {
    this.saved = structuredClone(workspace);
    return true;
  }
  async clear() {
    this.saved = null;
  }
  available() {
    return true;
  }
}

async function setup(initial: LocalWorkspace | null = null) {
  const engine = new ToyEngine();
  const store = new MemoryStore(initial);
  const notes: [string, string][] = [];
  const notify: Notify = (level, message) => notes.push([level, message]);
  const controller = new PlaygroundController({ engine, store, notify });
  await controller.init();
  return { engine, store, notes, controller };
}

describe("PlaygroundController", () => {
  it("starts with the default workspace and an empty chain", async () => {
    const { controller } = await setup();
    const state = controller.getState();
    expect(state.phase).toBe("ready");
    expect(state.doc.editor.contractName).toBe("con_demo_token");
    expect(state.contracts).toEqual([]);
  });

  it("deploys the editor contract, selects it, logs it and saves the chain", async () => {
    const { controller, engine, store } = await setup();
    const outcome = await controller.deploy("{}");
    expect(outcome?.ok).toBe(true);
    expect(engine.deploys[0]).toMatchObject({ signer: "demo", name: "con_demo_token", constructorKwargs: "{}" });
    const state = controller.getState();
    expect(state.contracts.map((c) => c.name)).toEqual(["con_demo_token"]);
    expect(state.contracts[0]!.methods.exports.map((m) => m.name)).toEqual(["transfer"]);
    expect(state.ui.selectedContract).toBe("con_demo_token");
    expect(state.log[0]).toMatchObject({ level: "success", action: "deploy", message: "Deployed con_demo_token." });
    expect(store.saved?.snapshot).toContain("balances:treasury");
    expect(store.saved?.doc.contracts.map((c) => c.name)).toEqual(["con_demo_token"]);
  });

  it("refuses an invalid contract name without touching the chain", async () => {
    const { controller, engine, notes } = await setup();
    controller.setEditor({ contractName: "Token" });
    expect(await controller.deploy("{}")).toBeUndefined();
    expect(engine.deploys).toEqual([]);
    expect(notes[0]?.[0]).toBe("error");
  });

  it("records a failed deploy", async () => {
    const { controller, engine, notes } = await setup();
    engine.failDeployOf = "con_demo_token";
    const outcome = await controller.deploy("{}");
    expect(outcome?.ok).toBe(false);
    expect(controller.getState().lastRun).toMatchObject({ kind: "deploy", metered: true, outcome: { error: "syntax error" } });
    expect(controller.getState().log[0]?.level).toBe("error");
    expect(notes.at(-1)).toEqual(["error", "Deploy failed: syntax error"]);
  });

  it("runs calls as the configured signer and shows the result and new state", async () => {
    const { controller, engine } = await setup();
    await controller.deploy("{}");
    await controller.updateEnvironment({ signer: "alice" });
    const outcome = await controller.call("con_demo_token", "transfer", '{"to":"bob","amount":25}');
    expect(outcome?.result).toBe("25");
    expect(engine.calls[0]).toMatchObject({ signer: "alice", kwargs: '{"to":"bob","amount":25}' });
    expect(controller.getState().state.map((e) => e.key)).toContain("con_demo_token.balances:bob");
    expect(controller.getState().log[0]?.message).toBe("Ran con_demo_token.transfer.");
  });

  it("reports a failed call", async () => {
    const { controller, notes } = await setup();
    await controller.deploy("{}");
    const before = notes.length;
    await controller.call("con_demo_token", "fail", "{}");
    expect(controller.getState().lastRun).toMatchObject({ metered: true, outcome: { ok: false, error: "Insufficient balance." } });
    // The result panel shows the failure; no extra toast.
    expect(notes.length).toBe(before);
  });

  it("validates environment changes before applying them", async () => {
    const { controller } = await setup();
    const errors = await controller.updateEnvironment({ now: "tomorrow", blockNum: "1.5", signer: "" }, { chiLimit: "0" });
    expect(Object.keys(errors).sort()).toEqual(["blockNum", "chiLimit", "now", "signer"]);
    expect(controller.getState().doc.environment.signer).toBe("demo");
    expect(await controller.updateEnvironment({ blockNum: "123456789012345678901234567890" })).toEqual({});
    expect(controller.getState().doc.environment.blockNum).toBe("123456789012345678901234567890");
  });

  it("applies state edits and logs what changed", async () => {
    const { controller, engine } = await setup();
    await controller.deploy("{}");
    expect(await controller.editState('{"con_demo_token": {"balances:treasury": 5, "balances:eve": 1.5}}')).toBe(true);
    expect(engine.store.get("con_demo_token.balances:treasury")).toBe("5");
    expect(engine.store.get("con_demo_token.balances:eve")).toBe('{"__fixed__":"1.5"}');
    expect(controller.getState().log[0]?.detail).toContain("con_demo_token.balances:treasury: 1000 -> 5");
  });

  it("rejects a state edit for an unknown contract", async () => {
    const { controller, notes } = await setup();
    expect(await controller.editState('{"con_nope": {}}')).toBe(false);
    expect(notes.at(-1)?.[1]).toMatch(/con_nope is not deployed/);
  });

  it("exports and re-imports a workspace by redeploying from source", async () => {
    const first = await setup();
    await first.controller.deploy("{}");
    await first.controller.call("con_demo_token", "transfer", "{}");
    const doc = first.controller.exportDoc();
    expect(doc.contracts[0]?.state).toEqual([
      ["balances:bob", "25"],
      ["balances:treasury", "1000"],
    ]);

    const second = await setup();
    expect(await second.controller.importDoc(doc, "share link")).toBe(true);
    expect(second.engine.store.get("con_demo_token.balances:bob")).toBe("25");
    expect(second.controller.getState().contracts.map((c) => c.name)).toEqual(["con_demo_token"]);
  });

  it("rolls back a failed import and keeps the current workspace", async () => {
    const { controller, engine } = await setup();
    await controller.deploy("{}");
    const doc: WorkspaceDoc = {
      ...defaultWorkspace(),
      contracts: [{ name: "con_broken", source: "x", constructorKwargs: "{}", state: [] }],
    };
    engine.failDeployOf = "con_broken";
    expect(await controller.importDoc(doc, "file")).toBe(false);
    expect(controller.getState().contracts.map((c) => c.name)).toEqual(["con_demo_token"]);
    expect(engine.store.has("con_demo_token.balances:treasury")).toBe(true);
  });

  it("restores the saved chain snapshot on start", async () => {
    const first = await setup();
    await first.controller.deploy("{}");
    const second = await setup(first.store.saved);
    expect(second.controller.getState().contracts.map((c) => c.name)).toEqual(["con_demo_token"]);
    expect(second.engine.deploys).toEqual([]);
  });

  it("redeploys from the saved document when no snapshot exists", async () => {
    const first = await setup();
    await first.controller.deploy("{}");
    const saved = { ...first.store.saved!, snapshot: null };
    const second = await setup(saved);
    expect(second.engine.deploys.map((d) => d.name)).toEqual(["con_demo_token"]);
  });

  it("removes contracts and resets the workspace", async () => {
    const { controller, engine } = await setup();
    await controller.deploy("{}");
    await controller.removeContract("con_demo_token");
    expect(controller.getState().contracts).toEqual([]);
    await controller.deploy("{}");
    controller.setEditor({ code: "x = 1" });
    await controller.resetWorkspace();
    expect(engine.store.size).toBe(0);
    expect(controller.getState().doc.editor.code).toContain("balances = Hash");
  });

  it("ignores a second action while one is running", async () => {
    const { controller, engine } = await setup();
    const [a, b] = await Promise.all([controller.deploy("{}"), controller.deploy("{}")]);
    expect([a?.ok, b]).toEqual([true, undefined]);
    expect(engine.deploys).toHaveLength(1);
  });

  it("reports an engine failure during an action and stays usable", async () => {
    const { controller, engine, notes } = await setup();
    engine.deploy = async () => {
      throw new Error("The VM crashed (unreachable). It was restarted from the last saved state.");
    };
    expect(await controller.deploy("{}")).toBeUndefined();
    expect(notes.at(-1)).toEqual(["error", "The VM crashed (unreachable). It was restarted from the last saved state."]);
    expect(controller.getState().busy).toBeNull();
    expect(controller.getState().log[0]).toMatchObject({ level: "error", action: "deploy" });
  });

  it("shows the saved workspace before the VM has started", async () => {
    const first = await setup();
    first.controller.setEditor({ code: "x = 1" });
    await first.controller.saveNow();
    const engine = new ToyEngine();
    let release!: () => void;
    const started = new Promise<void>((resolve) => (release = resolve));
    const original = engine.contracts.bind(engine);
    engine.contracts = async () => {
      await started;
      return original();
    };
    const controller = new PlaygroundController({ engine, store: first.store, notify: () => {} });
    const phases: string[] = [];
    controller.subscribe(() => phases.push(`${controller.getState().phase}/${controller.getState().engine}`));
    const done = controller.init();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getState()).toMatchObject({ phase: "ready", engine: "starting" });
    expect(controller.getState().doc.editor.code).toBe("x = 1");
    expect(await controller.deploy("{}")).toBeUndefined();
    release();
    await done;
    expect(controller.getState().engine).toBe("ready");
  });

  it("reports a start-up failure", async () => {
    const engine = new ToyEngine();
    engine.importSnapshot = async () => {
      throw new Error("corrupt snapshot");
    };
    const store = new MemoryStore({ doc: defaultWorkspace(), ui: (await setup()).controller.getState().ui, log: [], snapshot: "x" });
    const controller = new PlaygroundController({ engine, store, notify: () => {} });
    await controller.init();
    expect(controller.getState()).toMatchObject({ phase: "failed", loadError: "corrupt snapshot" });
    await controller.startFresh();
    expect(controller.getState()).toMatchObject({ phase: "ready", loadError: null, contracts: [] });
    expect(store.saved).toBeNull();
  });
});
