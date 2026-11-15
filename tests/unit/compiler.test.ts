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

describe("parseDiagnostics", () => {
  it("maps severities and ranges, defaulting a missing range to the first line", async () => {
    const { parseDiagnostics } = await import("@/lib/engine/compiler");
    const raw = JSON.stringify([
      { severity: "warning", code: "W1", message: "w", range: { start_line: 3, start_column: 4, end_line: 3, end_column: 9 } },
      { severity: "info", code: "I1", message: "i", range: null },
      { severity: "fatal", code: "E1", message: "e" },
    ]);
    expect(parseDiagnostics(raw)).toEqual([
      { severity: "warning", code: "W1", message: "w", line: 3, column: 5, endLine: 3, endColumn: 10 },
      { severity: "info", code: "I1", message: "i", line: 1, column: 1, endLine: 1, endColumn: 1 },
      { severity: "error", code: "E1", message: "e", line: 1, column: 1, endLine: 1, endColumn: 1 },
    ]);
    expect(() => parseDiagnostics("{}")).toThrow(/non-array/);
  });

  it("refuses artifacts for another module or without IR", async () => {
    const { parseArtifact, compilerErrorMessage } = await import("@/lib/engine/compiler");
    const ok = { format: "xian_contract_artifact_v1", module_name: "con_a", source: "s", vm_ir_json: "{}" };
    expect(parseArtifact("con_a", JSON.stringify(ok))).toEqual({ source: "s", vmIrJson: "{}" });
    expect(() => parseArtifact("con_b", JSON.stringify(ok))).toThrow(/unexpected artifact/);
    expect(() => parseArtifact("con_a", JSON.stringify({ ...ok, vm_ir_json: 5 }))).toThrow(/missing/);
    expect(compilerErrorMessage(new Error("first\nsecond"))).toBe("first");
    expect(compilerErrorMessage("")).toBe("The compiler failed.");
  });
});

describe("compiler fixtures used by the DOM tests", () => {
  it("still match the real compiler", async () => {
    const { readFileSync } = await import("node:fs");
    const { CONSTRUCTOR_SOURCE, FLOAT_SOURCE } = await import("./fixtures/compiler-fixtures");
    const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
    expect(compile("con_demo_token", DEFAULT_CONTRACT).vmIrJson).toBe(fixture("token_ir.json"));
    expect(compile("con_demo_token", CONSTRUCTOR_SOURCE).vmIrJson).toBe(fixture("constructor_ir.json"));
    const { parseDiagnostics } = await import("@/lib/engine/compiler-output");
    expect(diagnose("con_demo_token", FLOAT_SOURCE)).toEqual(parseDiagnostics(fixture("float_diagnostics.json")));
  });
});
