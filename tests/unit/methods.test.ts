import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { extractMethods } from "@/lib/contract/methods";

const IR = readFileSync(new URL("./fixtures/methods_ir.json", import.meta.url), "utf8");

describe("extractMethods (forms come from the compiled IR)", () => {
  const methods = extractMethods(IR);

  it("lists exported functions sorted by name and skips private ones", () => {
    expect(methods.exports.map((m) => m.name)).toEqual(["f", "kw", "transfer"]);
  });

  it("finds the constructor and its parameters", () => {
    expect(methods.constructor?.name).toBe("seed");
    expect(methods.constructor?.params).toEqual([
      { name: "initial", type: "int", annotation: "int", required: false, defaultText: "1000", keywordOnly: false },
    ]);
  });

  it("maps annotations to field types and keeps defaults readable", () => {
    const f = methods.exports.find((m) => m.name === "f")!;
    expect(f.docstring).toBe("Doc string here.");
    expect(f.params.map((p) => [p.name, p.type, p.required, p.defaultText])).toEqual([
      ["a", "int", false, "-5"],
      ["b", "str", false, "'hi'"],
      ["c", "decimal", false, "decimal('1.50')"],
      ["d", "datetime", false, "None"],
      ["e", "bool", false, "True"],
      ["g", "list", false, "expression"],
      ["h", "timedelta", false, "None"],
      ["i", "bytes", false, "None"],
      ["z", "any", false, "None"],
    ]);
  });

  it("marks keyword-only parameters", () => {
    const kw = methods.exports.find((m) => m.name === "kw")!;
    expect(kw.params.map((p) => [p.name, p.keywordOnly, p.required])).toEqual([
      ["x", true, true],
      ["y", true, false],
    ]);
  });

  it("returns no methods for unreadable IR", () => {
    expect(extractMethods("not json")).toEqual({ constructor: null, exports: [] });
    expect(extractMethods('{"functions": 3}')).toEqual({ constructor: null, exports: [] });
  });
});

describe("default value rendering", () => {
  const param = (name: string, def: unknown) => ({ name, annotation: null, kind: "positional_or_keyword", default: def });
  const ir = (params: unknown[]) => JSON.stringify({ functions: [{ name: "f", visibility: "export", parameters: params }] });
  const defaults = (params: unknown[]) => extractMethods(ir(params)).exports[0]!.params.map((p) => [p.type, p.defaultText]);
  const constant = (value: unknown, value_type: string) => ({ node: "constant", value, value_type });

  it("renders constants, negatives and decimal() calls; anything else is an expression", () => {
    expect(
      defaults([
        param("a", constant(false, "bool")),
        param("b", constant("1.5", "decimal")),
        param("c", { node: "unary_op", operator: "neg", operand: { node: "name", id: "x" } }),
        param("d", { node: "unary_op", operator: "not", operand: constant(true, "bool") }),
        param("e", { node: "call", func: { id: "decimal" }, args: [constant("2", "str"), constant("3", "str")] }),
        param("f", { node: "call", func: { id: "str" }, args: [] }),
        param("g", constant(null, "mystery")),
        param("h", null),
      ]),
    ).toEqual([
      ["any", "False"],
      ["any", "1.5"],
      ["any", "expression"],
      ["any", "expression"],
      ["any", "expression"],
      ["any", "expression"],
      ["any", "expression"],
      ["any", null],
    ]);
  });

  it("ignores functions without a name or visibility and malformed parameter lists", () => {
    const methods = extractMethods(
      JSON.stringify({ functions: [{ visibility: "export" }, { name: "g", visibility: "export", parameters: 5 }, 7] }),
    );
    expect(methods.exports).toEqual([{ name: "g", kind: "export", docstring: null, params: [] }]);
  });
});
