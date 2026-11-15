/**
 * The playground's view of the in-browser chain. One small interface the UI
 * codes against; `vm-engine.ts` implements it on top of `@xian-tech/vm`
 * (the node's xian-vm-core compiled to WebAssembly), and `worker-engine.ts`
 * runs that inside a Web Worker.
 * Every contract value crosses this boundary as V2 wire JSON text, never as a
 * JavaScript number.
 */

/** The block a transaction runs in (the signer travels on the request). */
export interface BlockEnvironment {
  /** ISO 8601 local time, e.g. 2024-02-01T12:30:00. */
  now: string;
  /** Integer text. */
  blockNum: string;
  blockHash: string;
  chainId: string;
  /** Seed input for `random.*`; empty means contracts cannot use randomness. */
  inputHash: string;
}

export interface Metering {
  enabled: boolean;
  /** Integer text; empty means the VM ceiling. Ignored when metering is off. */
  chiLimit: string;
}

export interface StateWrite {
  /** Full storage key, e.g. `con_token.balances:alice`. */
  key: string;
  /** Wire JSON text, or null when the key was deleted. */
  value: string | null;
}

export interface EmittedEvent {
  contract: string;
  event: string;
  /** Wire JSON text of the signer and caller. */
  signer: string;
  caller: string;
  /** Wire JSON dict texts of the indexed and the plain event fields. */
  dataIndexed: string;
  data: string;
}

export interface ExecutionOutcome {
  ok: boolean;
  /** True when the VM refused the request before running it (e.g. malformed kwargs). */
  rejected: boolean;
  /** Return value as wire JSON text (`null` when the function returned nothing); null when rejected. */
  result: string | null;
  /** Error message when `ok` is false. */
  error: string | null;
  /** Chi used (always a safe integer, bounded by the VM ceiling); 0 when unmetered. */
  chiUsed: number;
  writes: StateWrite[];
  events: EmittedEvent[];
}

export interface ContractArtifact {
  /** Canonical source from the compiler. */
  source: string;
  vmIrJson: string;
}

/** Like `submission.submit_contract`: the VM compiles the source itself. */
export interface DeployRequest {
  signer: string;
  name: string;
  source: string;
  /** Wire JSON object text. */
  constructorKwargs: string;
  environment: BlockEnvironment;
  metering: Metering;
}

export interface CallRequest {
  signer: string;
  contract: string;
  function: string;
  /** Wire JSON object text. */
  kwargs: string;
  environment: BlockEnvironment;
  metering: Metering;
}

export interface DeployedContract {
  name: string;
  source: string;
  vmIrJson: string;
}

export interface StateEntry {
  key: string;
  /** Wire JSON text. */
  value: string;
}

export interface PlaygroundEngine {
  deploy(request: DeployRequest): Promise<ExecutionOutcome>;
  call(request: CallRequest): Promise<ExecutionOutcome>;
  contracts(): Promise<DeployedContract[]>;
  /** Every stored key (protected `__` keys included; the UI filters). */
  state(): Promise<StateEntry[]>;
  /** Set or delete keys directly (state editor, imports). */
  writeState(writes: StateWrite[]): Promise<void>;
  removeContract(name: string): Promise<void>;
  /** The whole store, for browser persistence and rollback. */
  exportSnapshot(): Promise<string>;
  importSnapshot(snapshot: string): Promise<void>;
  reset(): Promise<void>;
}
