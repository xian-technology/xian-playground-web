import { describe, expect, it } from "vitest";

import { serveEngine, type MessagePortLike, type RpcRequest, type RpcResponse, type WorkerMessage } from "@/lib/engine/rpc";
import type { CallRequest, ExecutionOutcome, PlaygroundEngine } from "@/lib/engine/types";
import { WorkerEngine, type WorkerLike } from "@/lib/engine/worker-engine";

/** An in-memory engine double with a call that can hang forever. */
class MemoryEngine implements PlaygroundEngine {
  snapshot = "empty";
  imported: string[] = [];
  async deploy(): Promise<ExecutionOutcome> {
    this.snapshot = "deployed";
    return outcome();
  }
  async call(request: CallRequest): Promise<ExecutionOutcome> {
    if (request.function === "spin") return new Promise(() => {});
    if (request.function === "crash") throw new Error("engine bug");
    if (request.function === "panic") throw new WebAssembly.RuntimeError("unreachable");
    return outcome();
  }
  async contracts() {
    return [];
  }
  async state() {
    return [{ key: "con_a.v", value: "1" }];
  }
  async writeState() {}
  async removeContract() {}
  async exportSnapshot() {
    return this.snapshot;
  }
  async importSnapshot(snapshot: string) {
    this.imported.push(snapshot);
    this.snapshot = snapshot;
  }
  async reset() {
    this.snapshot = "empty";
  }
}

const outcome = (): ExecutionOutcome => ({ ok: true, rejected: false, result: "null", error: null, chiUsed: 0, writes: [], events: [] });

/** A Worker double that serves a fresh MemoryEngine over a message channel. */
function spawnFake(engines: MemoryEngine[], terminated: number[]): () => WorkerLike {
  return () => {
    const engine = new MemoryEngine();
    engines.push(engine);
    const index = engines.length - 1;
    const toPage: ((event: MessageEvent<WorkerMessage>) => void)[] = [];
    const toWorker: ((event: MessageEvent) => void)[] = [];
    let alive = true;
    const workerSide: MessagePortLike = {
      postMessage: (message) => queueMicrotask(() => alive && toPage.forEach((l) => l({ data: message } as MessageEvent<WorkerMessage>))),
      addEventListener: (_type, listener) => toWorker.push(listener),
    };
    // Like a module worker still awaiting its WebAssembly: messages sent
    // before the engine listens are lost.
    setTimeout(() => serveEngine(engine, workerSide), 5);
    return {
      postMessage: (message: RpcRequest) => queueMicrotask(() => toWorker.forEach((l) => l({ data: message } as MessageEvent))),
      addEventListener: (type: string, listener: (event: never) => void) => {
        if (type === "message") toPage.push(listener as (event: MessageEvent<WorkerMessage>) => void);
      },
      terminate: () => {
        alive = false;
        terminated.push(index);
      },
    } as WorkerLike;
  };
}

const call = (fn: string): CallRequest => ({
  signer: "a",
  contract: "con_a",
  function: fn,
  kwargs: "{}",
  environment: { now: "", blockNum: "", blockHash: "", chainId: "", inputHash: "" },
  metering: { enabled: false, chiLimit: "" },
});

describe("WorkerEngine", () => {
  it("forwards engine methods to the worker", async () => {
    const engines: MemoryEngine[] = [];
    const engine = new WorkerEngine(spawnFake(engines, []));
    expect(await engine.state()).toEqual([{ key: "con_a.v", value: "1" }]);
    expect((await engine.call(call("f"))).ok).toBe(true);
  });

  it("passes engine errors back as rejections", async () => {
    const engine = new WorkerEngine(spawnFake([], []));
    await expect(engine.call(call("crash"))).rejects.toThrow("engine bug");
  });

  it("stops a runaway call, restarts the worker and restores the last snapshot", async () => {
    const engines: MemoryEngine[] = [];
    const terminated: number[] = [];
    const engine = new WorkerEngine(spawnFake(engines, terminated), 50);
    await engine.deploy({} as never);
    expect(await engine.exportSnapshot()).toBe("deployed");
    const stopped = await engine.call(call("spin"));
    expect(stopped).toMatchObject({ ok: false, rejected: true, chiUsed: 0, error: expect.stringMatching(/^Stopped after 0.05 seconds/) });
    expect(terminated).toEqual([0]);
    expect(engines[1]!.imported).toEqual(["deployed"]);
    expect((await engine.call(call("f"))).ok).toBe(true);
  });

  it("restarts the worker from the last snapshot when the VM crashes", async () => {
    const engines: MemoryEngine[] = [];
    const terminated: number[] = [];
    const engine = new WorkerEngine(spawnFake(engines, terminated));
    await engine.deploy({} as never);
    await engine.exportSnapshot();
    const crashed = await engine.call(call("panic"));
    expect(crashed).toMatchObject({ ok: false, rejected: true, error: expect.stringMatching(/VM crashed/) });
    expect(terminated).toEqual([0]);
    expect(engines[1]!.imported).toEqual(["deployed"]);
    expect((await engine.call(call("f"))).ok).toBe(true);
  });

  it("fails pending requests when the worker reports an error", async () => {
    let fireError: ((event: ErrorEvent) => void) | undefined;
    const engine = new WorkerEngine(() => ({
      postMessage: () => {},
      addEventListener: (type: string, listener: (event: never) => void) => {
        if (type === "message") (listener as (event: MessageEvent) => void)({ data: { ready: true } } as MessageEvent);
        if (type === "error") fireError = listener as (event: ErrorEvent) => void;
      },
      terminate: () => {},
    }) as WorkerLike);
    const pending = engine.state();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireError!({ message: "" } as ErrorEvent);
    await expect(pending).rejects.toThrow("The engine worker crashed.");
  });

  it("rejects requests after startup failed and can reset with a fresh worker", async () => {
    let fireError: ((event: ErrorEvent) => void) | undefined;
    const engines: MemoryEngine[] = [];
    const spawnReady = spawnFake(engines, []);
    let first = true;
    const engine = new WorkerEngine(() => {
      if (!first) return spawnReady();
      first = false;
      return {
        postMessage: () => {},
        addEventListener: (type: string, listener: (event: never) => void) => {
          if (type === "error") fireError = listener as (event: ErrorEvent) => void;
        },
        terminate: () => {},
      } as WorkerLike;
    });
    fireError!({ message: "WASM startup failed" } as ErrorEvent);
    const stalled = new Promise((_, reject) => setTimeout(() => reject(new Error("request stalled")), 50));
    await expect(Promise.race([engine.state(), stalled])).rejects.toThrow("WASM startup failed");
    await engine.reset();
    expect(await engine.state()).toEqual([{ key: "con_a.v", value: "1" }]);
    expect(engines).toHaveLength(1);
  });

  it("ignores a terminated worker's late error while its replacement starts", async () => {
    const errors: ((event: ErrorEvent) => void)[] = [];
    const spawn = spawnFake([], []);
    const engine = new WorkerEngine(() => {
      const worker = spawn();
      return {
        ...worker,
        addEventListener: (type: string, listener: (event: never) => void) => {
          if (type === "error") errors.push(listener as (event: ErrorEvent) => void);
          (worker.addEventListener as (type: string, listener: (event: never) => void) => void)(type, listener);
        },
      } as WorkerLike;
    }, 30);
    expect((await engine.call(call("spin"))).ok).toBe(false);
    const pending = engine.state();
    errors[0]!({ message: "old worker failed" } as ErrorEvent);
    expect(await pending).toEqual([{ key: "con_a.v", value: "1" }]);
  });

  it("does not dispatch a canceled request after a failed startup reports ready", async () => {
    let fireError: ((event: ErrorEvent) => void) | undefined;
    let fireMessage: ((event: MessageEvent<WorkerMessage>) => void) | undefined;
    const posted: RpcRequest[] = [];
    const engine = new WorkerEngine(() => ({
      postMessage: (request: RpcRequest) => posted.push(request),
      addEventListener: (type: string, listener: (event: never) => void) => {
        if (type === "error") fireError = listener as (event: ErrorEvent) => void;
        if (type === "message") fireMessage = listener as (event: MessageEvent<WorkerMessage>) => void;
      },
      terminate: () => {},
    }) as WorkerLike);
    const pending = engine.state();
    fireError!({ message: "WASM startup failed" } as ErrorEvent);
    await expect(pending).rejects.toThrow("WASM startup failed");
    fireMessage!({ data: { ready: true } } as MessageEvent<WorkerMessage>);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted).toEqual([]);
  });

  it("refuses unknown methods on the worker side", async () => {
    const replies: RpcResponse[] = [];
    let listener: ((event: MessageEvent) => void) | undefined;
    serveEngine(new MemoryEngine(), {
      postMessage: (message) => replies.push(message as RpcResponse),
      addEventListener: (_type, l) => (listener = l),
    });
    listener!({ data: { id: 1, method: "constructor", args: [] } } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replies).toEqual([{ ready: true }, { id: 1, ok: false, error: "unknown engine method constructor" }]);
  });
});
