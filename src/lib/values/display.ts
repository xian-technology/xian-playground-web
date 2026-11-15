/**
 * Readable rendering of wire values. Numbers are shown exactly as the VM
 * wrote them (decimal text, integer digits); only the wrapper syntax around
 * them is replaced by something a contract author recognises.
 */

import { parseJson, stringifyJson, type JsonNode } from "./json";
import { DECIMAL_SCALE } from "./numbers";
import { parseWireJson } from "./wire";

export type ScalarType =
  | "int"
  | "decimal"
  | "str"
  | "bool"
  | "null"
  | "datetime"
  | "timedelta"
  | "bytes"
  | "bytearray"
  | "raw";

export type DisplayValue =
  | { kind: "scalar"; type: ScalarType; text: string }
  | { kind: "list"; type: "list" | "set" | "frozenset"; items: DisplayValue[] }
  | { kind: "dict"; entries: [string, DisplayValue][] };

const scalar = (type: ScalarType, text: string): DisplayValue => ({ kind: "scalar", type, text });

/** Describe VM output; text that is not valid wire JSON is shown raw. */
export function describeWire(text: string): DisplayValue {
  try {
    return describeNode(parseWireJson(text));
  } catch {
    return scalar("raw", text);
  }
}

export function describeNode(node: JsonNode): DisplayValue {
  switch (node.t) {
    case "null":
      return scalar("null", "None");
    case "bool":
      return scalar("bool", node.v ? "True" : "False");
    case "str":
      return scalar("str", node.v);
    case "num":
      return scalar("int", node.raw);
    case "arr":
      return { kind: "list", type: "list", items: node.items.map(describeNode) };
    case "obj":
      return describeObject(node);
  }
}

function describeObject(node: Extract<JsonNode, { t: "obj" }>): DisplayValue {
  const [tag, payload] = node.entries[0] ?? [];
  if (node.entries.length === 1 && tag !== undefined && payload !== undefined) {
    const wrapped = describeWrapper(tag, payload);
    if (wrapped) return wrapped;
  }
  return { kind: "dict", entries: node.entries.map(([key, value]) => [key, describeNode(value)]) };
}

function describeWrapper(tag: string, payload: JsonNode): DisplayValue | null {
  const ints = payload.t === "arr" ? payload.items.map((item) => (item.t === "num" ? Number(item.raw) : NaN)) : [];
  switch (tag) {
    case "__fixed__":
      return payload.t === "str" ? scalar("decimal", payload.v) : null;
    case "__big_int__":
      return payload.t === "str" ? scalar("int", payload.v) : null;
    case "__time__":
      return scalar("datetime", formatDatetime(ints));
    case "__delta__":
      return scalar("timedelta", formatTimedelta(ints[0] ?? 0, ints[1] ?? 0));
    case "__bytes__":
    case "__bytearray__":
      return payload.t === "str" ? scalar(tag === "__bytes__" ? "bytes" : "bytearray", `0x${payload.v}`) : null;
    case "__set__":
    case "__frozenset__":
      return describeSet(tag === "__set__" ? "set" : "frozenset", payload);
    default:
      return null;
  }
}

function describeSet(type: "set" | "frozenset", payload: JsonNode): DisplayValue | null {
  const items = payload.t === "obj" ? payload.entries.find(([key]) => key === "items")?.[1] : undefined;
  if (items?.t !== "arr") return null;
  return { kind: "list", type, items: items.items.map(describeSetMember) };
}

function describeSetMember(member: JsonNode): DisplayValue {
  if (member.t !== "arr") return scalar("raw", JSON.stringify(member));
  const [kind, value] = member.items;
  const text = value?.t === "str" ? value.v : "";
  switch (kind?.t === "str" ? kind.v : "") {
    case "none":
      return scalar("null", "None");
    case "bool":
      return scalar("bool", value?.t === "bool" && value.v ? "True" : "False");
    case "int":
      return scalar("int", text);
    case "str":
      return scalar("str", text);
    case "fixed":
      return scalar("decimal", unscaleFixed(text));
    case "tuple":
    case "frozenset":
      return value?.t === "arr"
        ? { kind: "list", type: kind?.t === "str" && kind.v === "tuple" ? "list" : "frozenset", items: value.items.map(describeSetMember) }
        : scalar("raw", "");
    default:
      return scalar("raw", JSON.stringify(member));
  }
}

/** The set codec stores decimals scaled by 10^30; render the canonical text. */
function unscaleFixed(scaled: string): string {
  const negative = scaled.startsWith("-");
  const digits = scaled.replace("-", "").padStart(DECIMAL_SCALE + 1, "0");
  const whole = digits.slice(0, -DECIMAL_SCALE);
  const fraction = digits.slice(-DECIMAL_SCALE).replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && text !== "0" ? `-${text}` : text;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function formatDatetime([year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0, micro = 0]: number[]): string {
  const base = `${pad(year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
  return micro ? `${base}.${pad(micro, 6)}` : base;
}

function formatTimedelta(days: number, seconds: number): string {
  const clock = `${Math.floor(seconds / 3600)}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  if (days === 0) return clock;
  return `${days} day${Math.abs(days) === 1 ? "" : "s"}, ${clock}`;
}

/** One-line text for a value, close to how contract code would print it. */
export function formatInline(value: DisplayValue): string {
  switch (value.kind) {
    case "scalar":
      return value.type === "str" ? JSON.stringify(value.text) : value.text;
    case "list": {
      const inner = value.items.map(formatInline).join(", ");
      if (value.type === "list") return `[${inner}]`;
      if (value.items.length === 0) return `${value.type}()`;
      return value.type === "set" ? `{${inner}}` : `frozenset({${inner}})`;
    }
    case "dict":
      return `{${value.entries.map(([key, entry]) => `${JSON.stringify(key)}: ${formatInline(entry)}`).join(", ")}}`;
  }
}

/** Pretty JSON of raw VM output, keeping every number token as written. */
export function prettyWire(text: string): string {
  try {
    return stringifyJson(parseJson(text), 2);
  } catch {
    return text;
  }
}

