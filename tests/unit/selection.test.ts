import { describe, expect, it } from "vitest";

import type { ContractView } from "@/lib/playground/controller";
import { resolveSelection } from "@/lib/playground/selection";

const contract = (name: string, fns: string[]): ContractView => ({
  name,
  source: "",
  vmIrJson: "",
  methods: { constructor: null, exports: fns.map((fn) => ({ name: fn, kind: "export", docstring: null, params: [] })) },
});
const all = [contract("con_a", ["f", "g"]), contract("con_b", ["h"]), contract("submission", ["submit_contract"])];

describe("resolveSelection", () => {
  it("hides system contracts unless asked and counts them", () => {
    const hidden = resolveSelection(all, false, "", "");
    expect(hidden.visible.map((c) => c.name)).toEqual(["con_a", "con_b"]);
    expect(hidden.hiddenSystemCount).toBe(1);
    expect(resolveSelection(all, true, "submission", "").contract?.name).toBe("submission");
  });

  it("keeps a saved choice and falls back when it is gone", () => {
    expect(resolveSelection(all, false, "con_b", "h").method?.name).toBe("h");
    const fallback = resolveSelection(all, false, "con_gone", "zzz");
    expect([fallback.contract?.name, fallback.method?.name]).toEqual(["con_a", "f"]);
    expect(resolveSelection(all, false, "submission", "").contract?.name).toBe("con_a");
  });

  it("is empty when nothing is deployed", () => {
    expect(resolveSelection([], false, "", "")).toEqual({ visible: [], hiddenSystemCount: 0, contract: null, method: null });
  });
});
