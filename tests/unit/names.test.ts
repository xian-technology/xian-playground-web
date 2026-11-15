import { describe, expect, it } from "vitest";

import { contractNameError, isSystemContract } from "@/lib/contract/names";

describe("contractNameError (submission rules)", () => {
  it("accepts con_ names of lowercase ascii, digits and underscores up to 64 chars", () => {
    expect(contractNameError("con_demo_token", "demo")).toBeNull();
    expect(contractNameError("con_" + "a".repeat(60), "demo")).toBeNull();
  });

  it("rejects names that break the rules", () => {
    for (const name of ["", "demo", "con_" + "a".repeat(61), "con_Demo", "con-demo", "con_dé", " con_x"]) {
      expect(contractNameError(name, "demo"), name).not.toBeNull();
    }
  });

  it("lets the sys signer deploy safe names without the con_ prefix", () => {
    expect(contractNameError("currency", "sys")).toBeNull();
    expect(contractNameError("1abc", "sys")).not.toBeNull();
  });

  it("keeps submission reserved", () => {
    expect(contractNameError("submission", "sys")).toMatch(/reserved/);
  });
});

describe("isSystemContract", () => {
  it("treats every name without the con_ prefix as a system contract", () => {
    expect(isSystemContract("submission")).toBe(true);
    expect(isSystemContract("currency")).toBe(true);
    expect(isSystemContract("con_x")).toBe(false);
  });
});
