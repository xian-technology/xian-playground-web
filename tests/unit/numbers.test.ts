import { describe, expect, it } from "vitest";

import { canonicalDecimal, parseInteger } from "@/lib/values/numbers";

describe("canonicalDecimal (mirrors xian-numeric canonical_decimal)", () => {
  it("renders exact values at both limits", () => {
    const maximum = `${"9".repeat(61)}.${"9".repeat(30)}`;
    expect(canonicalDecimal(maximum)).toBe(maximum);
    for (const [source, expected] of [
      ["-.5", "-0.5"],
      ["1.25", "1.25"],
      ["1.50", "1.5"],
      ["+0012300e-2", "123"],
      ["100000e-35", "0.000000000000000000000000000001"],
      ["-0e9999999999999999999999", "0"],
      ["-0", "0"],
      ["5.", "5"],
      ["1E+3", "1000"],
    ] as const) {
      expect(canonicalDecimal(source)).toBe(expected);
    }
  });

  it("rejects invalid and unrepresentable spellings", () => {
    for (const source of [
      "", ".", "+", "-", "１", " 1", "1 ", "1e", "1e+", "1_0", "1e1e1",
      "1.2.3", "1e-31", "1e61", "-1e99999999999999999999999",
      "1e-999999999999999999999", "NaN", "Infinity", "0x10", "1,5",
    ]) {
      expect(() => canonicalDecimal(source), source).toThrow();
    }
  });
});

describe("parseInteger", () => {
  it("accepts canonical integers up to 512 bits", () => {
    expect(parseInteger("0")).toBe(0n);
    expect(parseInteger("-42")).toBe(-42n);
    const max = (1n << 512n) - 1n;
    expect(parseInteger(max.toString())).toBe(max);
    expect(parseInteger((-max).toString())).toBe(-max);
  });

  it("rejects noncanonical or oversized integers", () => {
    const tooBig = (1n << 512n).toString();
    for (const source of ["", "-0", "007", "+1", "1.0", "1e3", " 1", "1 ", "--1", "0x1", tooBig]) {
      expect(() => parseInteger(source), source).toThrow();
    }
  });
});
