/**
 * Exported functions and the constructor of a contract, read from its
 * compiled Xian VM IR (`vm_ir_json`). Forms are built from this shape.
 */

import { parseJson, type JsonNode } from "@/lib/values/json";

export type ParamType =
  | "int"
  | "decimal"
  | "str"
  | "bool"
  | "dict"
  | "list"
  | "datetime"
  | "timedelta"
  | "bytes"
  | "bytearray"
  | "set"
  | "frozenset"
  | "any";

export interface MethodParam {
  name: string;
  type: ParamType;
  /** The annotation as written in the contract, or null. */
  annotation: string | null;
  required: boolean;
  /** The default value as contract source text, `expression` when it is computed. */
  defaultText: string | null;
  keywordOnly: boolean;
}

export interface ContractMethod {
  name: string;
  kind: "export" | "construct";
  docstring: string | null;
  params: MethodParam[];
}

export interface ContractMethods {
  constructor: ContractMethod | null;
  exports: ContractMethod[];
}

const ANNOTATION_TYPES: Record<string, ParamType> = {
  int: "int",
  decimal: "decimal",
  str: "str",
  bool: "bool",
  dict: "dict",
  list: "list",
  "datetime.datetime": "datetime",
  "datetime.timedelta": "timedelta",
  bytes: "bytes",
  bytearray: "bytearray",
  set: "set",
  frozenset: "frozenset",
  Any: "any",
};

type Obj = Extract<JsonNode, { t: "obj" }>;

function field(node: JsonNode | undefined, key: string): JsonNode | undefined {
  return node?.t === "obj" ? node.entries.find(([name]) => name === key)?.[1] : undefined;
}

function text(node: JsonNode | undefined): string | null {
  return node?.t === "str" ? node.v : null;
}

export function extractMethods(vmIrJson: string): ContractMethods {
  let functions: JsonNode | undefined;
  try {
    functions = field(parseJson(vmIrJson), "functions");
  } catch {
    return { constructor: null, exports: [] };
  }
  if (functions?.t !== "arr") return { constructor: null, exports: [] };
  const methods = functions.items.flatMap((node) => toMethod(node) ?? []);
  return {
    constructor: methods.find((method) => method.kind === "construct") ?? null,
    exports: methods.filter((method) => method.kind === "export").sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

function toMethod(node: JsonNode): ContractMethod | null {
  const kind = text(field(node, "visibility"));
  const name = text(field(node, "name"));
  if ((kind !== "export" && kind !== "construct") || name === null) return null;
  const params = field(node, "parameters");
  return {
    name,
    kind,
    docstring: text(field(node, "docstring")),
    params: params?.t === "arr" ? params.items.map(toParam) : [],
  };
}

function toParam(node: JsonNode): MethodParam {
  const annotation = text(field(node, "annotation"));
  const defaultNode = field(node, "default");
  const hasDefault = defaultNode !== undefined && defaultNode.t !== "null";
  return {
    name: text(field(node, "name")) ?? "",
    type: (annotation && ANNOTATION_TYPES[annotation]) || "any",
    annotation,
    required: !hasDefault,
    defaultText: hasDefault ? defaultSource(defaultNode) : null,
    keywordOnly: text(field(node, "kind")) === "keyword_only",
  };
}

/** Render simple default expressions the way the contract wrote them. */
function defaultSource(node: JsonNode): string {
  const kind = text(field(node, "node"));
  if (kind === "constant") return constantSource(node as Obj);
  if (kind === "unary_op" && text(field(node, "operator")) === "neg") {
    const operand = field(node, "operand");
    if (operand && text(field(operand, "node")) === "constant") return `-${constantSource(operand as Obj)}`;
  }
  if (kind === "call") {
    const callee = text(field(field(node, "func"), "id"));
    const args = field(node, "args");
    if (callee === "decimal" && args?.t === "arr" && args.items.length === 1) {
      return `decimal(${defaultSource(args.items[0]!)})`;
    }
  }
  return "expression";
}

function constantSource(node: Obj): string {
  const value = field(node, "value");
  switch (text(field(node, "value_type"))) {
    case "none":
      return "None";
    case "bool":
      return value?.t === "bool" && value.v ? "True" : "False";
    case "str":
      return `'${text(value) ?? ""}'`;
    default:
      return value?.t === "num" ? value.raw : (text(value) ?? "expression");
  }
}
