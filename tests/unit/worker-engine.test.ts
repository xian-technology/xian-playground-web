import { describe, expect, it } from "vitest";

import { serveEngine, type MessagePortLike, type RpcRequest, type RpcResponse } from "@/lib/engine/rpc";
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
    const toPage: ((event: MessageEvent<RpcResponse>) => void)[] = [];
    const toWorker: ((event: MessageEvent) => void)[] = [];
    let alive = true;
    const workerSide: MessagePortLike = {
      postMessage: (message) => queueMicrotask(() => alive && toPage.forEach((l) => l({ data: message } as MessageEvent<RpcResponse>))),
      addEventListener: (_type, listener) => toWorker.push(listener),
    };
    serveEngine(engine, workerSide);
    return {
      postMessage: (message: RpcRequest) => queueMicrotask(() => toWorker.forEach((l) => l({ data: message } as MessageEvent))),
      addEventListener: (type: string, listener: (event: never) => void) => {
        if (type === "message") toPage.push(listener as (event: MessageEvent<RpcResponse>) => void);
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
    expect(stopped).toMatchObject({ ok: false, rejected: true, error: expect.stringMatching(/Stopped after/) });
    expect(terminated).toEqual([0]);
    expect(engines[1]!.imported).toEqual(["deployed"]);
    expect((await engine.call(call("f"))).ok).toBe(true);
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
    expect(replies).toEqual([{ id: 1, ok: false, error: "unknown engine method constructor" }]);
  });
});
