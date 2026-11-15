/**
 * `PlaygroundEngine` on top of `@xian-tech/vm` (ENGINE_API.md): the node's
 * xian-vm-core compiled to WebAssembly with an in-memory store. Requests are
 * assembled as JSON text so wire values (kwargs) are embedded token for
 * token; outcomes carry values as wire text strings, which `JSON.parse`
 * leaves untouched.
 */

import { parseField } from "@/lib/contract/kwargs";
import { json, parseJson, stringifyJson, type JsonNode } from "@/lib/values/json";
import { isSafeInteger, parseInteger } from "@/lib/values/numbers";
import { integerToWire } from "@/lib/values/wire";

import type {
  BlockEnvironment,
  CallRequest,
  DeployedContract,
  DeployRequest,
  ExecutionOutcome,
  Metering,
  PlaygroundEngine,
  StateEntry,
  StateWrite,
} from "./types";

/** The slice of `VmChain` the adapter uses (lets tests pass a double). */
export interface VmChainLike {
  exportState(): string;
  deploy(requestJson: string): string;
  call(requestJson: string): string;
  items(prefix: string, limit?: number): string;
  setValue(key: string, wireText?: string): void;
  removeContract(name: string): void;
  contracts(): string;
  contract(name: string): string | undefined;
  free(): void;
}

export interface VmModuleLike {
  createChain(): VmChainLike;
  importChain(snapshot: string): VmChainLike;
}

interface TxOutcome {
  status: number;
  result: string;
  error: string | null;
  chi_used: number;
  writes: [string, string | null][];
  events: { contract: string; event: string; signer: string; caller: string; data_indexed: string; data: string }[];
}

export class VmEngine implements PlaygroundEngine {
  private chain: VmChainLike;

  constructor(private readonly vm: VmModuleLike) {
    this.chain = vm.createChain();
  }

  async deploy(request: DeployRequest): Promise<ExecutionOutcome> {
    const body = () => json.obj([
      ["sender", json.str(request.signer)],
      ["name", json.str(request.name)],
      ["source", json.str(request.source)],
      ["constructor_args", parseJson(request.constructorKwargs)],
      ...executionFields(request.environment, request.metering),
    ]);
    return this.run(() => this.chain.deploy(stringifyJson(body())));
  }

  async call(request: CallRequest): Promise<ExecutionOutcome> {
    const body = () => json.obj([
      ["sender", json.str(request.signer)],
      ["contract", json.str(request.contract)],
      ["function", json.str(request.function)],
      ["kwargs", parseJson(request.kwargs)],
      ...executionFields(request.environment, request.metering),
    ]);
    return this.run(() => this.chain.call(stringifyJson(body())));
  }

  async contracts(): Promise<DeployedContract[]> {
    const names = JSON.parse(this.chain.contracts()) as string[];
    return names.flatMap((name) => {
      const raw = this.chain.contract(name);
      if (raw === undefined) return [];
      const info = JSON.parse(raw) as { source: string; vm_ir_json: string };
      return [{ name, source: info.source, vmIrJson: info.vm_ir_json }];
    });
  }

  async state(): Promise<StateEntry[]> {
    return (JSON.parse(this.chain.items("")) as [string, string][]).map(([key, value]) => ({ key, value }));
  }

  async writeState(writes: StateWrite[]): Promise<void> {
    for (const write of writes) this.chain.setValue(write.key, write.value ?? undefined);
  }

  async removeContract(name: string): Promise<void> {
    this.chain.removeContract(name);
  }

  async exportSnapshot(): Promise<string> {
    return this.chain.exportState();
  }

  async importSnapshot(snapshot: string): Promise<void> {
    this.replace(this.vm.importChain(snapshot));
  }

  async reset(): Promise<void> {
    this.replace(this.vm.createChain());
  }

  private replace(chain: VmChainLike): void {
    this.chain.free();
    this.chain = chain;
  }

  /**
   * A request the VM refuses (or one that cannot be built, e.g. a bad chi
   * budget) throws; the UI shows it like a failed transaction.
   */
  private run(send: () => string): ExecutionOutcome {
    let outcome: TxOutcome;
    try {
      outcome = JSON.parse(send()) as TxOutcome;
    } catch (error) {
      return {
        ok: false,
        rejected: true,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        chiUsed: 0,
        writes: [],
        events: [],
      };
    }
    const ok = outcome.status === 0;
    return {
      ok,
      rejected: false,
      result: ok ? outcome.result : null,
      error: ok ? null : (outcome.error ?? "The transaction failed."),
      chiUsed: outcome.chi_used,
      writes: outcome.writes.map(([key, value]) => ({ key, value })),
      events: outcome.events.map((event) => ({
        contract: event.contract,
        event: event.event,
        signer: event.signer,
        caller: event.caller,
        dataIndexed: event.data_indexed,
        data: event.data,
      })),
    };
  }
}

/** Environment and metering fields of a deploy or call request. */
export function executionFields(environment: BlockEnvironment, metering: Metering): [string, JsonNode][] {
  const fields: [string, JsonNode][] = [["environment", environmentNode(environment)], ["metering", json.bool(metering.enabled)]];
  if (metering.enabled && metering.chiLimit.trim() !== "") {
    const budget = parseInteger(metering.chiLimit.trim());
    if (budget <= 0n || !isSafeInteger(budget)) throw new RangeError("The chi budget must be a positive whole number.");
    fields.push(["chi_budget", json.num(budget.toString())]);
  }
  return fields;
}

function environmentNode(environment: BlockEnvironment): JsonNode {
  const entries: [string, JsonNode][] = [];
  if (environment.now.trim()) entries.push(["now", parseField("datetime", environment.now)]);
  if (environment.blockNum.trim()) entries.push(["block_num", integerToWire(parseInteger(environment.blockNum.trim()))]);
  if (environment.blockHash) entries.push(["block_hash", json.str(environment.blockHash)]);
  if (environment.chainId) entries.push(["chain_id", json.str(environment.chainId)]);
  if (environment.inputHash) entries.push(["input_hash", json.str(environment.inputHash)]);
  return json.obj(entries);
}
