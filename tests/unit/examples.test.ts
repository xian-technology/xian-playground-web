import { VmChain } from "@xian-tech/vm";
import { describe, expect, it } from "vitest";

import { EXAMPLES } from "@/components/playground/examples";
import { diagnose } from "@/lib/engine/compiler";
import { VmEngine } from "@/lib/engine/vm-engine";
import { DEFAULT_ENVIRONMENT } from "@/lib/workspace/model";

describe("examples", () => {
  it.each(EXAMPLES.map((example) => [example.id, example] as const))("%s lints clean and deploys on the real VM", async (_id, example) => {
    expect(diagnose(example.contractName, example.code)).toEqual([]);
    const engine = new VmEngine({ createChain: () => new VmChain(), importChain: (s) => VmChain.importState(s) });
    const outcome = await engine.deploy({
      signer: "demo",
      name: example.contractName,
      source: example.code,
      constructorKwargs: "{}",
      environment: DEFAULT_ENVIRONMENT,
      metering: { enabled: true, chiLimit: "" },
    });
    expect(outcome.error).toBeNull();
    expect(outcome.ok).toBe(true);
  });

  it("the decimals example compounds exactly", async () => {
    const example = EXAMPLES.find((item) => item.id === "decimals")!;
    const engine = new VmEngine({ createChain: () => new VmChain(), importChain: (s) => VmChain.importState(s) });
    const base = { environment: DEFAULT_ENVIRONMENT, metering: { enabled: true, chiLimit: "" } };
    await engine.deploy({ ...base, signer: "demo", name: example.contractName, source: example.code, constructorKwargs: "{}" });
    await engine.call({ ...base, signer: "demo", contract: example.contractName, function: "deposit", kwargs: '{"amount":{"__fixed__":"0.1"}}' });
    const projected = await engine.call({ ...base, signer: "demo", contract: example.contractName, function: "projected", kwargs: '{"account":"demo","years":2}' });
    expect(projected).toMatchObject({ ok: true, result: '{"__fixed__":"0.11025"}' });
  });
});
