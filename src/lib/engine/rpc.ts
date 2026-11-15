/**
 * The message protocol between the page and the engine worker, plus the
 * worker-side dispatcher. Only `PlaygroundEngine` methods can be invoked.
 */

import type { PlaygroundEngine } from "./types";

export type EngineMethod = keyof PlaygroundEngine;

export const ENGINE_METHODS: readonly EngineMethod[] = [
  "deploy",
  "call",
  "contracts",
  "state",
  "writeState",
  "removeContract",
  "exportSnapshot",
  "importSnapshot",
  "reset",
];

export interface RpcRequest {
  id: number;
  method: EngineMethod;
  args: unknown[];
}

export type RpcResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

/**
 * Sent once the worker listens. A module worker that awaits its
 * WebAssembly at the top level drops messages that arrive before its
 * listener exists, so the page sends nothing until it sees this.
 */
export interface ReadyMessage {
  ready: true;
}

export type WorkerMessage = RpcResponse | ReadyMessage;

/** A message port: the worker global scope, a `Worker`, or a test double. */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** Answer RPC requests on `port` with `engine` (runs inside the worker). */
export function serveEngine(engine: PlaygroundEngine, port: MessagePortLike): void {
  port.addEventListener("message", (event: MessageEvent) => {
    const request = event.data as RpcRequest;
    void respond(engine, request).then((response) => port.postMessage(response));
  });
  port.postMessage({ ready: true } satisfies ReadyMessage);
}

async function respond(engine: PlaygroundEngine, request: RpcRequest): Promise<RpcResponse> {
  if (!ENGINE_METHODS.includes(request.method)) {
    return { id: request.id, ok: false, error: `unknown engine method ${String(request.method)}` };
  }
  try {
    const method = engine[request.method] as (...args: unknown[]) => Promise<unknown>;
    return { id: request.id, ok: true, value: await method.apply(engine, request.args) };
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
