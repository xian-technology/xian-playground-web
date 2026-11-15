/// <reference lib="webworker" />
/**
 * The engine worker: hosts the node's VM (`@xian-tech/vm`, WebAssembly) and
 * answers `PlaygroundEngine` RPCs from the page.
 */

import { VmChain } from "@xian-tech/vm";

import { serveEngine, type MessagePortLike } from "./rpc";
import { VmEngine } from "./vm-engine";

serveEngine(
  new VmEngine({
    createChain: () => new VmChain(),
    importChain: (snapshot) => VmChain.importState(snapshot),
  }),
  self as unknown as MessagePortLike,
);
