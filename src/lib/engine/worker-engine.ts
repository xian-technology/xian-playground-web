/**
 * `PlaygroundEngine` proxy that runs the real engine in a Web Worker so a
 * long contract call never freezes the page. A call that runs past the time
 * limit is stopped by terminating the worker; a fresh worker is started from
 * the last snapshot this proxy saw, so the chain loses nothing that was
 * committed before the runaway call.
 */

import type { RpcRequest, RpcResponse, WorkerMessage } from "./rpc";
import type {
  CallRequest,
  DeployedContract,
  DeployRequest,
  ExecutionOutcome,
  PlaygroundEngine,
  StateEntry,
  StateWrite,
} from "./types";

export interface WorkerLike {
  postMessage(message: RpcRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerMessage>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

export const DEFAULT_TRANSACTION_TIMEOUT_MS = 10_000;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class EngineTimeoutError extends Error {}

/** The VM inside the worker panicked; its WebAssembly instance cannot be used again. */
export class VmCrashError extends Error {}

export class WorkerEngine implements PlaygroundEngine {
  private worker!: WorkerLike;
  private ready!: Promise<void>;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private checkpoint: string | null = null;
  private failure: Error | null = null;

  constructor(
    private readonly spawn: () => WorkerLike,
    private readonly timeoutMs = DEFAULT_TRANSACTION_TIMEOUT_MS,
  ) {
    this.start();
  }

  deploy(request: DeployRequest): Promise<ExecutionOutcome> {
    return this.transaction("deploy", request);
  }

  call(request: CallRequest): Promise<ExecutionOutcome> {
    return this.transaction("call", request);
  }

  contracts(): Promise<DeployedContract[]> {
    return this.send("contracts", []) as Promise<DeployedContract[]>;
  }

  state(): Promise<StateEntry[]> {
    return this.send("state", []) as Promise<StateEntry[]>;
  }

  writeState(writes: StateWrite[]): Promise<void> {
    return this.send("writeState", [writes]) as Promise<void>;
  }

  removeContract(name: string): Promise<void> {
    return this.send("removeContract", [name]) as Promise<void>;
  }

  async exportSnapshot(): Promise<string> {
    const snapshot = (await this.send("exportSnapshot", [])) as string;
    this.checkpoint = snapshot;
    return snapshot;
  }

  async importSnapshot(snapshot: string): Promise<void> {
    await this.send("importSnapshot", [snapshot]);
    this.checkpoint = snapshot;
  }

  async reset(): Promise<void> {
    if (this.failure !== null) await this.restart();
    await this.send("reset", []);
    this.checkpoint = null;
  }

  private start(): void {
    this.failure = null;
    const worker = this.spawn();
    this.worker = worker;
    let markReady!: () => void;
    this.ready = new Promise((resolve) => (markReady = resolve));
    worker.addEventListener("message", (event) => {
      if (worker !== this.worker) return;
      if ("ready" in event.data) markReady();
      else this.settle(event.data);
    });
    worker.addEventListener("error", (event) => {
      if (worker !== this.worker) return;
      this.failure = new Error(event.message || "The engine worker crashed.");
      this.failAll(this.failure);
    });
  }

  private settle(response: RpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.value);
    else pending.reject(response.fatal ? new VmCrashError(response.error) : new Error(response.error));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  /** Send a request; after a VM crash, restart from the checkpoint and report it. */
  private async send(method: RpcRequest["method"], args: unknown[]): Promise<unknown> {
    try {
      return await this.post(method, args);
    } catch (error) {
      if (!(error instanceof VmCrashError)) throw error;
      await this.restart();
      throw new VmCrashError(crashMessage(error.message));
    }
  }

  private post(method: RpcRequest["method"], args: unknown[]): Promise<unknown> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const id = this.nextId++;
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      void this.ready.then(() => {
        if (this.pending.has(id)) worker.postMessage({ id, method, args });
      });
    });
  }

  private async transaction(method: "deploy" | "call", request: DeployRequest | CallRequest): Promise<ExecutionOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EngineTimeoutError()), this.timeoutMs);
    });
    try {
      return (await Promise.race([this.send(method, [request]), timeout])) as ExecutionOutcome;
    } catch (error) {
      if (error instanceof VmCrashError) return failedOutcome(error.message);
      if (!(error instanceof EngineTimeoutError)) throw error;
      await this.restart();
      return failedOutcome(
        `Stopped after ${this.timeoutMs / 1000} seconds without finishing. Turn on metering so the VM stops runaway code on its own.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Replace a stuck worker and bring the chain back to the last checkpoint. */
  private async restart(): Promise<void> {
    this.worker.terminate();
    this.failAll(new Error("The engine was restarted."));
    this.start();
    if (this.checkpoint !== null) await this.post("importSnapshot", [this.checkpoint]);
  }
}

function crashMessage(detail: string): string {
  return `The VM crashed (${detail}). It was restarted from the last saved state; changes from this action were not kept.`;
}

function failedOutcome(error: string): ExecutionOutcome {
  return {
    ok: false,
    rejected: true,
    result: null,
    error,
    chiUsed: 0,
    writes: [],
    events: [],
  };
}
