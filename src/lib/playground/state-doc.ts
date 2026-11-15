/**
 * Contract state as the UI shows and edits it: `{contract: {key: value}}`
 * documents, the edit plan that turns an edited document into key writes,
 * and the portable (export / share) form of deployed contracts.
 *
 * Storage keys look like `con_token.balances:alice`: the contract name, a
 * dot, then the variable key. Keys starting with `__` are protected runtime
 * metadata (`__code__`, `__owner__`, ...).
 */

import type { StateEntry, StateWrite } from "@/lib/engine/types";
import type { PortableContract } from "@/lib/workspace/model";
import { json, parseJson, stringifyJson, type JsonNode } from "@/lib/values/json";
import { sourceJsonToWire, toWire } from "@/lib/values/wire";

export interface ContractMeta {
  name: string;
  source: string;
  constructorKwargs: string;
}

export interface StateGroup {
  contract: string;
  entries: { key: string; value: string }[];
}

export function splitKey(fullKey: string): { contract: string; key: string } {
  const dot = fullKey.indexOf(".");
  return dot < 0 ? { contract: fullKey, key: "" } : { contract: fullKey.slice(0, dot), key: fullKey.slice(dot + 1) };
}

export const isProtectedKey = (key: string) => key.startsWith("__");

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function groupState(entries: StateEntry[], showProtected: boolean): StateGroup[] {
  const groups = new Map<string, StateGroup["entries"]>();
  for (const entry of entries) {
    const { contract, key } = splitKey(entry.key);
    if (!showProtected && (isProtectedKey(key) || !contract.startsWith("con_"))) continue;
    groups.set(contract, [...(groups.get(contract) ?? []), { key, value: entry.value }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([contract, items]) => ({ contract, entries: items.sort((a, b) => byText(a.key, b.key)) }));
}

/** The JSON document of the state panel (old playground: sorted, public keys only). */
export function buildStateDocument(entries: StateEntry[], showProtected: boolean): JsonNode {
  return json.obj(
    groupState(entries, showProtected).map(({ contract, entries: items }) => [
      contract,
      json.obj(items.map(({ key, value }) => [key, parseOrString(value)])),
    ]),
  );
}

function parseOrString(text: string): JsonNode {
  try {
    return parseJson(text);
  } catch {
    return json.str(text);
  }
}

/**
 * Turn an edited state document into writes. Only contracts named in the
 * document change; within them, public keys missing from the document are
 * deleted, protected keys are never touched.
 */
export function planStateEdit(entries: StateEntry[], deployed: string[], editedText: string): StateWrite[] {
  const edited = sourceJsonToWire(editedText);
  if (edited.t !== "obj") throw new TypeError("State must be a JSON object of contracts.");
  const writes: StateWrite[] = [];
  for (const [contract, keys] of edited.entries) {
    if (!contract.startsWith("con_")) throw new TypeError(`System contract ${contract} cannot be edited here.`);
    if (!deployed.includes(contract)) throw new TypeError(`Contract ${contract} is not deployed.`);
    if (keys.t !== "obj") throw new TypeError(`State for ${contract} must be an object of keys.`);
    const provided: [string, string | null][] = keys.entries
      .filter(([key]) => !isProtectedKey(key))
      .map(([key, value]) => [key, value.t === "null" ? null : stringifyJson(value)]);
    writes.push(...contractWrites(contract, provided, entries));
  }
  return writes;
}

/** Writes that make a contract's public state equal `provided`. */
function contractWrites(contract: string, provided: [string, string | null][], entries: StateEntry[]): StateWrite[] {
  const current = new Map(
    entries
      .map((entry) => ({ ...splitKey(entry.key), value: entry.value }))
      .filter((entry) => entry.contract === contract && !isProtectedKey(entry.key))
      .map((entry) => [entry.key, canonical(entry.value)]),
  );
  const writes: StateWrite[] = [];
  const named = new Set<string>();
  for (const [key, value] of provided) {
    named.add(key);
    if (value === null ? current.has(key) : current.get(key) !== value) {
      writes.push({ key: `${contract}.${key}`, value });
    }
  }
  for (const key of current.keys()) {
    if (!named.has(key)) writes.push({ key: `${contract}.${key}`, value: null });
  }
  return writes;
}

function canonical(text: string): string {
  try {
    return stringifyJson(toWire(parseJson(text), "wire"));
  } catch {
    return text;
  }
}

/** Restore an exported contract's public state on top of a fresh deploy. */
export function restoreWrites(contract: string, state: [string, string][], entries: StateEntry[]): StateWrite[] {
  return contractWrites(contract, state, entries);
}

export function toPortableContracts(meta: ContractMeta[], entries: StateEntry[]): PortableContract[] {
  const groups = new Map(groupState(entries, false).map((group) => [group.contract, group.entries]));
  return meta.map((contract) => ({
    ...contract,
    state: (groups.get(contract.name) ?? []).map(({ key, value }): [string, string] => [key, value]),
  }));
}
