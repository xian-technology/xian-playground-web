/**
 * A strict JSON parser that keeps every number as its source token and every
 * object as an ordered entry list. `JSON.parse` would round large integers and
 * decimals and reorder integer-like keys; contract values must not change
 * between what the VM returns and what the playground shows.
 */

export type JsonNode =
  | { t: "null" }
  | { t: "bool"; v: boolean }
  | { t: "str"; v: string }
  | { t: "num"; raw: string }
  | { t: "arr"; items: JsonNode[] }
  | { t: "obj"; entries: [string, JsonNode][] };

export const MAX_JSON_DEPTH = 64;

const NUMBER_TOKEN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const ESCAPES: Record<string, string> = {
  '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
};

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parseDocument(): JsonNode {
    const node = this.value(0);
    this.skipWhitespace();
    if (this.pos !== this.text.length) this.fail("unexpected trailing characters");
    return node;
  }

  private fail(message: string): never {
    throw new SyntaxError(`Invalid JSON at position ${this.pos}: ${message}`);
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && " \t\n\r".includes(this.text[this.pos]!)) this.pos += 1;
  }

  private value(depth: number): JsonNode {
    this.skipWhitespace();
    const char = this.text[this.pos];
    if (char === "{" || char === "[") {
      if (depth >= MAX_JSON_DEPTH) this.fail(`values are nested deeper than ${MAX_JSON_DEPTH} levels`);
      return char === "{" ? this.object(depth + 1) : this.array(depth + 1);
    }
    if (char === '"') return { t: "str", v: this.string() };
    for (const [word, node] of LITERALS) {
      if (this.text.startsWith(word, this.pos)) {
        this.pos += word.length;
        return node;
      }
    }
    return this.number();
  }

  private number(): JsonNode {
    NUMBER_TOKEN.lastIndex = this.pos;
    const match = NUMBER_TOKEN.exec(this.text);
    if (!match) this.fail("expected a value");
    this.pos += match[0].length;
    return { t: "num", raw: match[0] };
  }

  private string(): string {
    this.pos += 1;
    let out = "";
    for (;;) {
      const char = this.text[this.pos];
      if (char === undefined) this.fail("unterminated string");
      if (char === '"') break;
      if (char < " ") this.fail("control character in string");
      if (char === "\\") {
        out += this.escape();
      } else {
        out += char;
        this.pos += 1;
      }
    }
    this.pos += 1;
    return out;
  }

  private escape(): string {
    const code = this.text[this.pos + 1] ?? "";
    if (code === "u") {
      const hex = this.text.slice(this.pos + 2, this.pos + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("invalid unicode escape");
      this.pos += 6;
      return String.fromCharCode(parseInt(hex, 16));
    }
    const decoded = ESCAPES[code];
    if (decoded === undefined) this.fail("invalid escape");
    this.pos += 2;
    return decoded;
  }

  private array(depth: number): JsonNode {
    this.pos += 1;
    const items: JsonNode[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos += 1;
      return { t: "arr", items };
    }
    for (;;) {
      items.push(this.value(depth));
      if (this.endOfList("]")) return { t: "arr", items };
    }
  }

  private object(depth: number): JsonNode {
    this.pos += 1;
    const entries: [string, JsonNode][] = [];
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos += 1;
      return { t: "obj", entries };
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') this.fail("expected a string key");
      const key = this.string();
      if (seen.has(key)) this.fail(`duplicate key ${JSON.stringify(key)}`);
      seen.add(key);
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") this.fail("expected ':'");
      this.pos += 1;
      entries.push([key, this.value(depth)]);
      if (this.endOfList("}")) return { t: "obj", entries };
    }
  }

  /** Consume `,` (more items follow) or the closing bracket (list done). */
  private endOfList(close: string): boolean {
    this.skipWhitespace();
    const char = this.text[this.pos];
    this.pos += 1;
    if (char === close) return true;
    if (char !== ",") this.fail(`expected ',' or '${close}'`);
    return false;
  }
}

const LITERALS: [string, JsonNode][] = [
  ["null", { t: "null" }],
  ["true", { t: "bool", v: true }],
  ["false", { t: "bool", v: false }],
];

export function parseJson(text: string): JsonNode {
  return new Parser(text).parseDocument();
}

/** Serialize a node; numbers are emitted exactly as their stored token. */
export function stringifyJson(node: JsonNode, indent = 0): string {
  return write(node, indent, 0);
}

function write(node: JsonNode, indent: number, level: number): string {
  switch (node.t) {
    case "null":
      return "null";
    case "bool":
      return node.v ? "true" : "false";
    case "str":
      return JSON.stringify(node.v);
    case "num":
      return node.raw;
    case "arr":
      return container("[", "]", node.items.map((item) => write(item, indent, level + 1)), indent, level);
    case "obj":
      return container(
        "{",
        "}",
        node.entries.map(([key, value]) => `${JSON.stringify(key)}:${indent ? " " : ""}${write(value, indent, level + 1)}`),
        indent,
        level,
      );
  }
}

function container(open: string, close: string, parts: string[], indent: number, level: number): string {
  if (parts.length === 0) return open + close;
  if (!indent) return open + parts.join(",") + close;
  const inner = " ".repeat(indent * (level + 1));
  const outer = " ".repeat(indent * level);
  return `${open}\n${inner}${parts.join(`,\n${inner}`)}\n${outer}${close}`;
}

/** Build helpers for code that assembles wire values. */
export const json = {
  str: (v: string): JsonNode => ({ t: "str", v }),
  num: (raw: string): JsonNode => ({ t: "num", raw }),
  bool: (v: boolean): JsonNode => ({ t: "bool", v }),
  arr: (items: JsonNode[]): JsonNode => ({ t: "arr", items }),
  obj: (entries: [string, JsonNode][]): JsonNode => ({ t: "obj", entries }),
  null: (): JsonNode => ({ t: "null" }),
};
