/**
 * The playground's view of the in-browser chain. One small interface the UI
 * codes against; `wasm-engine.ts` implements it on top of `@xian-tech/vm`.
 * Every contract value crosses this boundary as V2 wire JSON text, never as a
 * JavaScript number.
 */

export interface ExecutionEnvironment {
  signer: string;
  /** ISO 8601 local time, e.g. 2024-02-01T12:30:00. */
  now: string;
  /** Integer text. */
  blockNum: string;
  blockHash: string;
  chainId: string;
}

export interface Metering {
  enabled: boolean;
  /** Integer text; ignored when metering is off. */
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
  /** Wire JSON text of the event payload. */
  data: string;
}

export interface ExecutionOutcome {
  ok: boolean;
  /** Return value as wire JSON text (`null` text when the function returned nothing). */
  result: string | null;
  /** Error message when `ok` is false. */
  error: string | null;
  /** Chi used as integer text, null when the engine did not meter. */
  chiUsed: string | null;
  writes: StateWrite[];
  events: EmittedEvent[];
}

export interface ContractArtifact {
  /** Canonical source from the compiler. */
  source: string;
  vmIrJson: string;
}

export interface DeployRequest {
  name: string;
  artifact: ContractArtifact;
  /** Wire JSON object text. */
  constructorKwargs: string;
  environment: ExecutionEnvironment;
  metering: Metering;
}

export interface CallRequest {
  contract: string;
  function: string;
  /** Wire JSON object text. */
  kwargs: string;
  environment: ExecutionEnvironment;
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
