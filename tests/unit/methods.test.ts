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
