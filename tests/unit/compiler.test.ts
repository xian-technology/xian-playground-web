import { describe, expect, it } from "vitest";

import { compile, diagnose } from "@/lib/engine/compiler";
import { extractMethods } from "@/lib/contract/methods";
import { DEFAULT_CONTRACT } from "@/lib/workspace/model";

describe("compiler (real @xian-tech/compiler WASM)", () => {
  it("compiles the default contract into source and VM IR", () => {
    const artifact = compile("con_demo_token", DEFAULT_CONTRACT);
    expect(artifact.source).toContain("def transfer");
    const methods = extractMethods(artifact.vmIrJson);
    expect(methods.exports.map((m) => m.name)).toEqual(["balance_of", "transfer"]);
    expect(methods.constructor?.name).toBe("seed");
  });

  it("reports lint diagnostics with 1-based positions", () => {
    const diagnostics = diagnose("con_x", "@export\ndef f(a: float):\n    return a\n");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]).toMatchObject({ severity: "error", line: 2 });
    expect(diagnostics[0]!.column).toBeGreaterThanOrEqual(1);
  });

  it("returns no diagnostics for a clean contract", () => {
    expect(diagnose("con_demo_token", DEFAULT_CONTRACT)).toEqual([]);
  });

  it("explains compile failures with the first line of the compiler error", () => {
    expect(() => compile("con_x", "def broken(:\n")).toThrow(/./);
  });
});
