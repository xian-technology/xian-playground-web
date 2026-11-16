import { canonicalDecimal as vmCanonicalDecimal, runtimeInfo, VmChain } from "@xian-tech/vm";
import { describe, expect, it } from "vitest";

import { buildKwargs } from "@/lib/contract/kwargs";
import { extractMethods } from "@/lib/contract/methods";
import { VmEngine } from "@/lib/engine/vm-engine";
import type { BlockEnvironment, Metering } from "@/lib/engine/types";
import { stringifyJson } from "@/lib/values/json";
import { canonicalDecimal } from "@/lib/values/numbers";
import { DEFAULT_CONTRACT, DEFAULT_ENVIRONMENT } from "@/lib/workspace/model";

const env: BlockEnvironment = DEFAULT_ENVIRONMENT;
const metered: Metering = { enabled: true, chiLimit: "" };
const engine = () => new VmEngine({ createChain: () => new VmChain(), importChain: (s) => VmChain.importState(s) });

describe("VmEngine on the real @xian-tech/vm", () => {
  it("reports the engine versions", () => {
    expect(JSON.parse(runtimeInfo())).toHaveProperty("execution_revision");
  });

  it("deploys the default contract and runs a transfer", async () => {
    const vm = engine();
    const deployed = await vm.deploy({ signer: "demo", name: "con_demo_token", source: DEFAULT_CONTRACT, constructorKwargs: "{}", environment: env, metering: metered });
    expect(deployed).toMatchObject({ ok: true, rejected: false });
    const contracts = await vm.contracts();
    expect(contracts.map((c) => c.name)).toContain("con_demo_token");
    const token = contracts.find((c) => c.name === "con_demo_token")!;
    const transfer = extractMethods(token.vmIrJson).exports.find((m) => m.name === "transfer")!;

    const short = buildKwargs(transfer, { to: "bob", amount: "25" });
    if (!short.ok) throw new Error("kwargs");
    const failed = await vm.call({ signer: "demo", contract: "con_demo_token", function: "transfer", kwargs: stringifyJson(short.kwargs), environment: env, metering: metered });
    expect(failed).toMatchObject({ ok: false, rejected: false, error: "Insufficient balance." });

    const ok = await vm.call({ signer: "treasury", contract: "con_demo_token", function: "transfer", kwargs: stringifyJson(short.kwargs), environment: env, metering: metered });
    expect(ok.ok).toBe(true);
    expect(ok.chiUsed).toBeGreaterThan(0);
    expect(ok.writes).toEqual(expect.arrayContaining([{ key: "con_demo_token.balances:bob", value: "25" }]));
    const state = await vm.state();
    expect(state).toEqual(expect.arrayContaining([{ key: "con_demo_token.balances:treasury", value: "975" }]));
  });

  it("refuses a bare float in kwargs before running", async () => {
    const vm = engine();
    await vm.deploy({ signer: "demo", name: "con_demo_token", source: DEFAULT_CONTRACT, constructorKwargs: "{}", environment: env, metering: metered });
    const refused = await vm.call({ signer: "treasury", contract: "con_demo_token", function: "transfer", kwargs: '{"to":"bob","amount":1.5}', environment: env, metering: metered });
    expect(refused).toMatchObject({ ok: false, rejected: true });
  });

  it("round trips the chain through a snapshot", async () => {
    const vm = engine();
    await vm.deploy({ signer: "demo", name: "con_demo_token", source: DEFAULT_CONTRACT, constructorKwargs: "{}", environment: env, metering: metered });
    const snapshot = await vm.exportSnapshot();
    const other = engine();
    await other.importSnapshot(snapshot);
    expect(await other.state()).toEqual(await vm.state());
  });

  it("preserves prototype-named dictionary data and optional parameter defaults", async () => {
    const vm = engine();
    const source = "@export\ndef choose(constructor: str = 'treasury', data: dict = None):\n    return [constructor, data['__proto__']]\n";
    const deployed = await vm.deploy({ signer: "demo", name: "con_keys", source, constructorKwargs: "{}", environment: env, metering: metered });
    expect(deployed.ok).toBe(true);
    const methods = extractMethods((await vm.contracts()).find((contract) => contract.name === "con_keys")!.vmIrJson);
    const method = methods.exports.find((entry) => entry.name === "choose")!;
    const kwargs = buildKwargs(method, { data: '{"__proto__":"payload"}' });
    expect(kwargs.ok, JSON.stringify({ method, kwargs })).toBe(true);
    if (!kwargs.ok) throw new Error("kwargs");
    const result = await vm.call({ signer: "demo", contract: "con_keys", function: "choose", kwargs: stringifyJson(kwargs.kwargs), environment: env, metering: metered });
    expect(result).toMatchObject({ ok: true, result: '["treasury","payload"]' });
  });

  it("agrees with the VM's own decimal canonicalizer (differential)", () => {
    const samples = [
      "1.50", "-.5", "+0012300e-2", "100000e-35", "-0e9999999999999999999999", "0", "5.", "1E+3",
      `${"9".repeat(61)}.${"9".repeat(30)}`, "", ".", "+", "1e", "1_0", "1e-31", "1e61", " 1", "0.1", "-0",
    ];
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647);
    const alphabet = "0123456789.-+eE";
    for (let i = 0; i < 2000; i += 1) {
      samples.push(Array.from({ length: 1 + (next() % 12) }, () => alphabet[next() % alphabet.length]).join(""));
    }
    const outcome = (fn: (t: string) => string, text: string) => {
      try {
        return fn(text);
      } catch {
        return "<error>";
      }
    };
    for (const text of samples) {
      expect(outcome(canonicalDecimal, text), JSON.stringify(text)).toBe(outcome(vmCanonicalDecimal, text));
    }
  });
});
