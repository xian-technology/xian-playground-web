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
  if (node.entries.length === 1) {
    const [tag, payload] = node.entries[0]!;
    const wrapped = describeWrapper(tag, payload);
    if (wrapped) return wrapped;
  }
  return { kind: "dict", entries: node.entries.map(([key, value]) => [key, describeNode(value)]) };
}

type Decoder = (payload: JsonNode | undefined) => DisplayValue | null;

const textOf = (node: JsonNode | undefined): string | null => (node?.t === "str" ? node.v : null);
const intsOf = (node: JsonNode | undefined): number[] =>
  node?.t === "arr" ? node.items.map((item) => (item.t === "num" ? Number(item.raw) : NaN)) : [];
const textScalar = (type: ScalarType, render: (text: string) => string = (text) => text): Decoder => (payload) => {
  const text = textOf(payload);
  return text === null ? null : scalar(type, render(text));
};

/** Single-key runtime wrappers of the wire format. */
const WRAPPERS: Record<string, Decoder> = {
  __fixed__: textScalar("decimal"),
  __big_int__: textScalar("int"),
  __time__: (payload) => scalar("datetime", formatDatetime(intsOf(payload))),
  __delta__: (payload) => {
    const [days = 0, seconds = 0] = intsOf(payload);
    return scalar("timedelta", formatTimedelta(days, seconds));
  },
  __bytes__: textScalar("bytes", (hex) => `0x${hex}`),
  __bytearray__: textScalar("bytearray", (hex) => `0x${hex}`),
  __set__: (payload) => describeSet("set", payload),
  __frozenset__: (payload) => describeSet("frozenset", payload),
};

function describeWrapper(tag: string, payload: JsonNode): DisplayValue | null {
  return WRAPPERS[tag]?.(payload) ?? null;
}

function describeSet(type: "set" | "frozenset", payload: JsonNode | undefined): DisplayValue | null {
  const items = payload?.t === "obj" ? payload.entries.find(([key]) => key === "items")?.[1] : undefined;
  if (items?.t !== "arr") return null;
  return { kind: "list", type, items: items.items.map(describeSetMember) };
}

const nested = (type: "list" | "frozenset"): Decoder => (value) =>
  value?.t === "arr" ? { kind: "list", type, items: value.items.map(describeSetMember) } : null;

/** Typed members of the `xian-set-1` codec: `[kind, value]`. */
const SET_MEMBERS: Record<string, Decoder> = {
  none: () => scalar("null", "None"),
  bool: (value) => scalar("bool", value?.t === "bool" && value.v ? "True" : "False"),
  int: textScalar("int"),
  str: textScalar("str"),
  fixed: textScalar("decimal", (scaled) => unscaleFixed(scaled)),
  bytes: textScalar("bytes", (hex) => `0x${hex}`),
  datetime: (value) => scalar("datetime", formatDatetime(intsOf(value))),
  timedelta: textScalar("timedelta", (total) => {
    const seconds = Number(total);
    return formatTimedelta(Math.floor(seconds / 86_400), ((seconds % 86_400) + 86_400) % 86_400);
  }),
  tuple: nested("list"),
  frozenset: nested("frozenset"),
};

function describeSetMember(member: JsonNode): DisplayValue {
  const [kind, value] = member.t === "arr" ? member.items : [];
  const decoded = kind?.t === "str" ? SET_MEMBERS[kind.v]?.(value) : null;
  return decoded ?? scalar("raw", stringifyJson(member));
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

