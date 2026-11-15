/**
 * Typed form inputs to exact V2 wire kwargs. Each field is text; the parser
 * for its annotation turns it into a wire JSON node or explains what is wrong.
 * The VM stays the final authority: it validates every value again.
 */

import { json, type JsonNode } from "@/lib/values/json";
import { canonicalDecimal, DECIMAL_SCALE, parseInteger } from "@/lib/values/numbers";
import { integerToWire, sourceJsonToWire } from "@/lib/values/wire";

import type { ContractMethod, ParamType } from "./methods";

export type FieldValues = Record<string, string | undefined>;
export type KwargsResult =
  | { ok: true; kwargs: JsonNode }
  | { ok: false; errors: Record<string, string> };

const SECONDS_PER_DAY = 86_400n;
const MAX_TIMEDELTA_DAYS = 999_999_999n;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/;
const SET_CODEC = "xian-set-1";

type FieldParser = (text: string) => JsonNode;

const PARSERS: Record<ParamType, FieldParser> = {
  int: (text) => integerToWire(integer(text.trim(), "Enter a whole number such as 25 or -3.")),
  decimal: (text) => json.obj([["__fixed__", json.str(decimal(text.trim()))]]),
  str: (text) => json.str(text),
  bool: parseBool,
  datetime: parseDatetime,
  timedelta: parseTimedelta,
  bytes: (text) => hexWrapper("__bytes__", text),
  bytearray: (text) => hexWrapper("__bytearray__", text),
  dict: (text) => expectJson(text, "obj", "Enter a JSON object such as {\"key\": 1}."),
  list: (text) => expectJson(text, "arr", "Enter a JSON array such as [1, 2]."),
  set: (text) => setWrapper("__set__", text),
  frozenset: (text) => setWrapper("__frozenset__", text),
  any: (text) => userJson(text),
};

/** Parse one field; throws an Error whose message is shown next to the field. */
export function parseField(type: ParamType, text: string): JsonNode {
  return PARSERS[type](text);
}

export function buildKwargs(method: ContractMethod, values: FieldValues): KwargsResult {
  const entries: [string, JsonNode][] = [];
  const errors: Record<string, string> = {};
  for (const param of method.params) {
    const raw = values[param.name] ?? "";
    if (raw === "" && param.type !== "str") {
      if (param.required) errors[param.name] = "Enter a value.";
      continue;
    }
    if (raw === "" && !param.required) continue;
    try {
      entries.push([param.name, parseField(param.type, raw)]);
    } catch (error) {
      errors[param.name] = error instanceof Error ? error.message : String(error);
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, kwargs: json.obj(entries) };
}

function integer(text: string, message: string): bigint {
  try {
    return parseInteger(text);
  } catch (error) {
    if (error instanceof RangeError && /512/.test(error.message)) throw new Error("This number is larger than 512 bits.");
    throw new Error(message);
  }
}

function decimal(text: string): string {
  try {
    return canonicalDecimal(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (/fractional/.test(reason)) throw new Error(`Use at most ${DECIMAL_SCALE} digits after the decimal point.`);
    if (/10\^61/.test(reason)) throw new Error("This decimal is too large (must be below 10^61).");
    throw new Error("Enter a decimal such as 1.5 (use a dot, no commas).");
  }
}

function parseBool(text: string): JsonNode {
  if (text === "true" || text === "false") return json.bool(text === "true");
  throw new Error("Choose true or false.");
}

function parseDatetime(text: string): JsonNode {
  const match = DATETIME.exec(text.trim());
  if (!match) throw new Error("Use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS.");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part ?? "0")) as number[];
  const micro = Number((match[7] ?? "").padEnd(6, "0"));
  const daysInMonth = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  if (year! < 1 || month! < 1 || month! > 12 || day! < 1 || day! > daysInMonth) {
    throw new Error("This date does not exist.");
  }
  if (hour! > 23 || minute! > 59 || second! > 59) throw new Error("This time does not exist.");
  return json.obj([["__time__", json.arr([year!, month!, day!, hour!, minute!, second!, micro].map((n) => json.num(String(n))))]]);
}

function parseTimedelta(text: string): JsonNode {
  const total = integer(text.trim(), "Enter whole seconds such as 3600 or -60.");
  let days = total / SECONDS_PER_DAY;
  let seconds = total % SECONDS_PER_DAY;
  if (seconds < 0n) {
    days -= 1n;
    seconds += SECONDS_PER_DAY;
  }
  if (days > MAX_TIMEDELTA_DAYS || days < -MAX_TIMEDELTA_DAYS) throw new Error("This duration is too long.");
  return json.obj([["__delta__", json.arr([json.num(days.toString()), json.num(seconds.toString())])]]);
}

function hexWrapper(tag: "__bytes__" | "__bytearray__", text: string): JsonNode {
  const hex = text.trim();
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Enter hex bytes such as 00ff (two digits per byte).");
  return json.obj([[tag, json.str(hex.toLowerCase())]]);
}

function userJson(text: string): JsonNode {
  try {
    return sourceJsonToWire(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof SyntaxError) {
      throw new Error(`Enter JSON; wrap text in double quotes, e.g. "alice". (${reason})`);
    }
    throw new Error(reason);
  }
}

function expectJson(text: string, kind: "obj" | "arr", message: string): JsonNode {
  const node = userJson(text);
  if (node.t !== kind || isWrapper(node)) throw new Error(message);
  return node;
}

function isWrapper(node: JsonNode): boolean {
  return node.t === "obj" && node.entries.length === 1 && /^__\w+__$/.test(node.entries[0]![0]);
}

/** A JSON array of scalars becomes the VM's typed set member envelope. */
function setWrapper(tag: "__set__" | "__frozenset__", text: string): JsonNode {
  const node = expectJson(text, "arr", "Enter a JSON array such as [1, \"a\"].");
  const items = (node as Extract<JsonNode, { t: "arr" }>).items.map(setMember);
  return json.obj([[tag, json.obj([["codec", json.str(SET_CODEC)], ["items", json.arr(items)]])]]);
}

function setMember(node: JsonNode): JsonNode {
  switch (node.t) {
    case "null":
      return json.arr([json.str("none")]);
    case "bool":
      return json.arr([json.str("bool"), node]);
    case "str":
      return json.arr([json.str("str"), node]);
    case "num":
      return json.arr([json.str("int"), json.str(node.raw)]);
    case "obj": {
      const [tag, payload] = node.entries[0] ?? [];
      if (node.entries.length === 1 && payload?.t === "str") {
        if (tag === "__fixed__") return json.arr([json.str("fixed"), json.str(scaledFixed(payload.v))]);
        if (tag === "__big_int__") return json.arr([json.str("int"), payload]);
      }
      break;
    }
  }
  throw new Error("set members must be null, true/false, numbers or strings.");
}

/** A canonical decimal as its integer scaled by 10^30 (the set codec's `fixed`). */
function scaledFixed(canonical: string): string {
  const negative = canonical.startsWith("-");
  const [whole = "", fraction = ""] = canonical.replace("-", "").split(".");
  const digits = (whole + fraction.padEnd(DECIMAL_SCALE, "0")).replace(/^0+(?=\d)/, "");
  return negative && digits !== "0" ? `-${digits}` : digits;
}
