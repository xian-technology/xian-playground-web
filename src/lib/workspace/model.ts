/**
 * The portable workspace: what a share link or an export file carries, and
 * what the playground restores. Contracts travel as source plus their public
 * state and are recompiled and redeployed on import, so a link can never
 * smuggle in VM IR that differs from the source it shows.
 */

import { contractNameError } from "@/lib/contract/names";
import { parseWireJson } from "@/lib/values/wire";

export const WORKSPACE_FORMAT = "xian-playground-workspace";
export const WORKSPACE_VERSION = 1;
/** The compiler's own source limit (`max_source_bytes`). */
export const MAX_SOURCE_BYTES = 131_072;
export const MAX_CONTRACTS = 64;
export const MAX_STATE_ENTRIES = 10_000;

export const DEFAULT_CONTRACT_NAME = "con_demo_token";
export const DEFAULT_CONTRACT = `balances = Hash(default_value=0)


@construct
def seed():
    balances['treasury'] = 1_000


@export
def transfer(to: str, amount: int):
    assert amount > 0, 'Amount must be positive.'
    assert balances[ctx.caller] >= amount, 'Insufficient balance.'

    balances[ctx.caller] -= amount
    balances[to] += amount


@export
def balance_of(account: str):
    return balances[account]
`;

export interface EnvironmentSettings {
  signer: string;
  /** ISO 8601 local time, e.g. 2024-02-01T12:30:00. */
  now: string;
  blockNum: string;
  blockHash: string;
  chainId: string;
}

export interface MeteringSettings {
  enabled: boolean;
  /** Chi budget as integer text. */
  chiLimit: string;
}

export interface PortableContract {
  name: string;
  source: string;
  /** Constructor kwargs used at deploy time, as wire JSON text. */
  constructorKwargs: string;
  /** Public state entries: key relative to the contract, wire JSON value text. */
  state: [string, string][];
}

export interface WorkspaceDoc {
  format: typeof WORKSPACE_FORMAT;
  version: typeof WORKSPACE_VERSION;
  editor: { code: string; contractName: string };
  environment: EnvironmentSettings;
  metering: MeteringSettings;
  contracts: PortableContract[];
}

export const DEFAULT_ENVIRONMENT: EnvironmentSettings = {
  signer: "demo",
  now: "2024-02-01T12:30:00",
  blockNum: "100",
  blockHash: "0xabc...",
  chainId: "playground-local",
};

export const DEFAULT_METERING: MeteringSettings = { enabled: false, chiLimit: "200000" };

export function defaultWorkspace(): WorkspaceDoc {
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    editor: { code: DEFAULT_CONTRACT, contractName: DEFAULT_CONTRACT_NAME },
    environment: { ...DEFAULT_ENVIRONMENT },
    metering: { ...DEFAULT_METERING },
    contracts: [],
  };
}

type Record_ = Record<string, unknown>;

function record(value: unknown, path: string): Record_ {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record_;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new TypeError(`${path} must be text.`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be true or false.`);
  return value;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be a list.`);
  if (value.length > max) throw new RangeError(`${path} has more than ${max} items.`);
  return value;
}

/** Validate untrusted input (a decoded share link or an imported file). */
export function parseWorkspaceDoc(input: unknown): WorkspaceDoc {
  const doc = record(input, "The workspace");
  if (doc.format !== WORKSPACE_FORMAT) throw new TypeError("This is not a playground workspace.");
  if (doc.version !== WORKSPACE_VERSION) throw new TypeError(`Unsupported workspace version ${String(doc.version)}.`);
  const editor = record(doc.editor, "editor");
  const env = record(doc.environment, "environment");
  const metering = record(doc.metering, "metering");
  const names = new Set<string>();
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    editor: {
      code: sourceText(editor.code, "editor.code"),
      contractName: string(editor.contractName, "editor.contractName"),
    },
    environment: {
      signer: string(env.signer, "environment.signer"),
      now: string(env.now, "environment.now"),
      blockNum: string(env.blockNum, "environment.blockNum"),
      blockHash: string(env.blockHash, "environment.blockHash"),
      chainId: string(env.chainId, "environment.chainId"),
    },
    metering: {
      enabled: boolean(metering.enabled, "metering.enabled"),
      chiLimit: string(metering.chiLimit, "metering.chiLimit"),
    },
    contracts: array(doc.contracts, "contracts", MAX_CONTRACTS).map((item, index) => {
      const contract = parseContract(item, `contracts[${index}]`);
      if (names.has(contract.name)) throw new TypeError(`Contract ${contract.name} appears twice.`);
      names.add(contract.name);
      return contract;
    }),
  };
}

function sourceText(value: unknown, path: string): string {
  const text = string(value, path);
  if (new TextEncoder().encode(text).length > MAX_SOURCE_BYTES) {
    throw new RangeError(`${path} is too large (over ${MAX_SOURCE_BYTES / 1024} KB).`);
  }
  return text;
}

function parseContract(input: unknown, path: string): PortableContract {
  const contract = record(input, path);
  const name = string(contract.name, `${path}.name`);
  // Imports never use the sys signer exemption: only con_ names travel.
  if (contractNameError(name, "") !== null) throw new TypeError(`${path} has an invalid contract name.`);
  const constructorKwargs = wireText(contract.constructorKwargs, `${path}.constructorKwargs`);
  return {
    name,
    source: sourceText(contract.source, `${path}.source`),
    constructorKwargs,
    state: array(contract.state, `${path}.state`, MAX_STATE_ENTRIES).map((entry, index) =>
      parseStateEntry(entry, `${path}.state[${index}]`),
    ),
  };
}

function parseStateEntry(input: unknown, path: string): [string, string] {
  const entry = array(input, path, 2);
  const key = string(entry[0], `${path} key`);
  if (key.startsWith("__")) throw new TypeError(`${path} writes the protected key ${key}.`);
  return [key, wireText(entry[1], `${path} value`)];
}

function wireText(value: unknown, path: string): string {
  const text = string(value, path);
  try {
    parseWireJson(text);
  } catch (error) {
    throw new TypeError(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return text;
}
