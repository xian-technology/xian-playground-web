/** The production engine: the real VM in a Web Worker. */

import { WorkerEngine, type WorkerLike } from "./worker-engine";
import type { PlaygroundEngine } from "./types";

export function createBrowserEngine(): PlaygroundEngine {
  return new WorkerEngine(
    () => new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module", name: "xian-vm" }) as unknown as WorkerLike,
  );
}
