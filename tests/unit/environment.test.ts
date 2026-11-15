import { describe, expect, it } from "vitest";

import { environmentErrors } from "@/lib/playground/controller";
import { DEFAULT_ENVIRONMENT, DEFAULT_METERING } from "@/lib/workspace/model";

const errors = (env: Partial<typeof DEFAULT_ENVIRONMENT>, chiLimit = "") =>
  environmentErrors({ ...DEFAULT_ENVIRONMENT, ...env }, { ...DEFAULT_METERING, chiLimit });

describe("environmentErrors", () => {
  it("accepts the defaults and empty optional fields", () => {
    expect(errors({})).toEqual({});
    expect(errors({ now: "", blockNum: "", blockHash: "", chainId: "", inputHash: "" })).toEqual({});
  });

  it("names each invalid field", () => {
    expect(Object.keys(errors({ signer: " ", now: "2024-02-30", blockNum: "-0" }, "abc")).sort()).toEqual([
      "blockNum",
      "chiLimit",
      "now",
      "signer",
    ]);
  });

  it("bounds the chi budget to the VM ceiling", () => {
    expect(errors({}, "1000000")).toEqual({});
    expect(errors({}, "1")).toEqual({});
    expect(errors({}, "1000001")).toHaveProperty("chiLimit");
    expect(errors({}, "0")).toHaveProperty("chiLimit");
  });
});
