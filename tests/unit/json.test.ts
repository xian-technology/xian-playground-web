import { describe, expect, it } from "vitest";

import { parseJson, stringifyJson, type JsonNode } from "@/lib/values/json";

describe("parseJson", () => {
  it("keeps numeric tokens and key order exactly as written", () => {
    const node = parseJson('{"b": 12345678901234567890123, "1": 1.50, "a": [true, null, "x"]}');
    expect(stringifyJson(node)).toBe('{"b":12345678901234567890123,"1":1.50,"a":[true,null,"x"]}');
  });

  it("decodes string escapes", () => {
    const node = parseJson('"a\\n\\u00e9\\"\\\\\\/"');
    expect(node).toEqual({ t: "str", v: 'a\né"\\/' });
  });

  it("pretty prints with indentation", () => {
    expect(stringifyJson(parseJson('{"a":[1,{}],"b":[]}'), 2)).toBe(
      '{\n  "a": [\n    1,\n    {}\n  ],\n  "b": []\n}',
    );
  });

  it("rejects malformed JSON with a position", () => {
    for (const text of ["", "{", "[1,]", '{"a":1,}', "01", "1.", ".5", "-", "NaN", "'x'", '"\\x"', '{"a" 1}', "[1] 2", '"\u0001"', "{a:1}"]) {
      expect(() => parseJson(text), JSON.stringify(text)).toThrow(/JSON/);
    }
  });

  it("rejects duplicate object keys", () => {
    expect(() => parseJson('{"a":1,"a":2}')).toThrow(/duplicate key "a"/);
  });

  it("limits nesting depth", () => {
    expect(() => parseJson("[".repeat(65) + "]".repeat(65))).toThrow(/nested/);
    expect(() => parseJson("[".repeat(64) + "]".repeat(64))).not.toThrow();
  });

  it("does not treat __proto__ as special", () => {
    const node = parseJson('{"__proto__": {"x": 1}}') as Extract<JsonNode, { t: "obj" }>;
    expect(node.entries[0]?.[0]).toBe("__proto__");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
