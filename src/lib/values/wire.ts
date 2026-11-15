/**
 * The V2 runtime wire format: JSON where integers beyond 2^53 are
 * `{"__big_int__": "..."}`, decimals are `{"__fixed__": "<canonical>"}`, and the
 * other runtime types use single-key wrappers (`__time__`, `__delta__`,
 * `__bytes__`, `__bytearray__`, `__set__`, `__frozenset__`).
 *
 * Two entry points:
 * - `sourceJsonToWire` reads JSON a person typed: bare decimals become
 *   `__fixed__`, unsafe bare integers become `__big_int__` (the old Python app
 *   did the same with `json.loads(parse_float=Decimal)` + `normalize_wire_numbers`).
 * - `parseWireJson` reads JSON the VM produced and refuses anything a lossy
 *   reader could silently change.
 */

import { json, parseJson, type JsonNode } from "./json";
import { canonicalDecimal, isSafeInteger, parseInteger } from "./numbers";

export const RESERVED_TAGS = [
  "__fixed__",
  "__big_int__",
  "__time__",
  "__delta__",
  "__bytes__",
  "__bytearray__",
  "__set__",
  "__frozenset__",
] as const;
export type ReservedTag = (typeof RESERVED_TAGS)[number];

type Mode = "source" | "wire";

export function sourceJsonToWire(text: string): JsonNode {
  return toWire(parseJson(text), "source");
}

export function parseWireJson(text: string): JsonNode {
  return toWire(parseJson(text), "wire");
}

/** Validate an already parsed tree; numbers are converted in `source` mode. */
export function toWire(node: JsonNode, mode: Mode): JsonNode {
  switch (node.t) {
    case "num":
      return numberToWire(node.raw, mode);
    case "arr":
      return json.arr(node.items.map((item) => toWire(item, mode)));
    case "obj":
      return objectToWire(node, mode);
    default:
      return node;
  }
}

export function integerToWire(value: bigint): JsonNode {
  return isSafeInteger(value) ? json.num(value.toString()) : json.obj([["__big_int__", json.str(value.toString())]]);
}

function numberToWire(raw: string, mode: Mode): JsonNode {
  if (/[.eE]/.test(raw)) {
    if (mode === "wire") throw new TypeError(`bare decimal ${raw} in VM output`);
    return json.obj([["__fixed__", json.str(canonicalDecimal(raw))]]);
  }
  const value = parseInteger(raw);
  if (mode === "wire" && !isSafeInteger(value)) {
    throw new TypeError(`bare integer ${raw} needs __big_int__`);
  }
  return integerToWire(value);
}

function objectToWire(node: Extract<JsonNode, { t: "obj" }>, mode: Mode): JsonNode {
  const tag = node.entries.find(([key]) => (RESERVED_TAGS as readonly string[]).includes(key))?.[0];
  if (tag === undefined) {
    return json.obj(node.entries.map(([key, value]) => [key, toWire(value, mode)]));
  }
  if (node.entries.length !== 1) throw new TypeError("a runtime wrapper must contain a single key");
  checkWrapper(tag as ReservedTag, node.entries[0]![1]);
  return node;
}

/** Payload rules per runtime tag; each returns false for an invalid payload. */
const PAYLOAD_RULES: Record<ReservedTag, (payload: JsonNode) => boolean> = {
  __fixed__: (payload) => payload.t === "str" && canonicalOrNull(payload.v) === payload.v,
  __big_int__: (payload) => payload.t === "str" && isCanonicalBigInt(payload.v),
  __time__: (payload) => isSafeIntArray(payload, [3, 4, 5, 6, 7]),
  __delta__: (payload) => isSafeIntArray(payload, [2]),
  __bytes__: isHexText,
  __bytearray__: isHexText,
  // Typed member envelopes are validated by the VM itself.
  __set__: (payload) => payload.t === "obj",
  __frozenset__: (payload) => payload.t === "obj",
};

const PAYLOAD_ERRORS: Partial<Record<ReservedTag, string>> = {
  __fixed__: "noncanonical __fixed__ decimal",
  __big_int__: "noncanonical __big_int__",
};

function checkWrapper(tag: ReservedTag, payload: JsonNode): void {
  if (!PAYLOAD_RULES[tag](payload)) throw new TypeError(PAYLOAD_ERRORS[tag] ?? `invalid ${tag} payload`);
}

function isHexText(payload: JsonNode): boolean {
  return payload.t === "str" && /^(?:[0-9a-fA-F]{2})*$/.test(payload.v);
}

function canonicalOrNull(text: string): string | null {
  try {
    return canonicalDecimal(text);
  } catch {
    return null;
  }
}

function isCanonicalBigInt(text: string): boolean {
  try {
    return !isSafeInteger(parseInteger(text));
  } catch {
    return false;
  }
}

function isSafeIntArray(node: JsonNode, lengths: number[]): boolean {
  if (node.t !== "arr" || !lengths.includes(node.items.length)) return false;
  return node.items.every((item) => {
    if (item.t !== "num" || /[.eE]/.test(item.raw)) return false;
    try {
      return isSafeInteger(parseInteger(item.raw));
    } catch {
      return false;
    }
  });
}
