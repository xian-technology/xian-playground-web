import { describe, expect, it } from "vitest";

import { VmEngine, type VmChainLike } from "@/lib/engine/vm-engine";
import type { BlockEnvironment, Metering } from "@/lib/engine/types";

/** A recording double of the wasm-bindgen VmChain surface (ENGINE_API.md v1). */
class FakeChain implements VmChainLike {
  sent: string[] = [];
  freed = false;
  values = new Map<string, string>();
  reply = '{"status":0,"result":"null","error":null,"chi_used":0,"writes":[],"events":[]}';
  constructor(readonly label = "fresh") {}
  exportState() {
    return JSON.stringify({ format: "xian-vm-state/1", entries: [...this.values], label: this.label });
  }
  deploy(request: string) {
    this.sent.push(request);
    return this.reply;
  }
  call(request: string) {
    this.sent.push(request);
    if (request.includes('"boom"')) throw new Error("kwargs refused: fractional number");
    return this.reply;
  }
  items() {
    return JSON.stringify([...this.values]);
  }
  setValue(key: string, wire?: string) {
    if (wire === undefined) this.values.delete(key);
    else this.values.set(key, wire);
  }
  removeContract(name: string) {
    for (const key of [...this.values.keys()]) if (key.startsWith(`${name}.`)) this.values.delete(key);
  }
  contracts() {
    return '["con_a","submission"]';
  }
  contract(name: string) {
    return name === "con_a" ? '{"name":"con_a","source":"x = 1","vm_ir_json":"{}"}' : undefined;
  }
  free() {
    this.freed = true;
  }
}

function setup() {
  const chains: FakeChain[] = [];
  const engine = new VmEngine({
    createChain: () => {
      chains.push(new FakeChain());
      return chains.at(-1)!;
    },
    importChain: (snapshot) => {
      chains.push(new FakeChain(`imported:${snapshot}`));
      return chains.at(-1)!;
    },
  });
  return { engine, chains };
}

const env: BlockEnvironment = {
  now: "2024-02-01T12:30:00",
  blockNum: "100",
  blockHash: "0xabc",
  chainId: "playground-local",
  inputHash: "seed",
};
const metered: Metering = { enabled: true, chiLimit: "" };

describe("VmEngine", () => {
  it("sends calls with kwargs embedded exactly and the environment in VM form", async () => {
    const { engine, chains } = setup();
    await engine.call({
      signer: "alice",
      contract: "con_a",
      function: "transfer",
      kwargs: '{"to":"bob","amount":{"__fixed__":"0.000000000000000000000000000001"},"n":{"__big_int__":"9007199254740993"}}',
      environment: env,
      metering: { enabled: true, chiLimit: "5000" },
    });
    expect(chains[0]!.sent[0]).toBe(
      '{"sender":"alice","contract":"con_a","function":"transfer",' +
        '"kwargs":{"to":"bob","amount":{"__fixed__":"0.000000000000000000000000000001"},"n":{"__big_int__":"9007199254740993"}},' +
        '"environment":{"now":{"__time__":[2024,2,1,12,30,0,0]},"block_num":100,"block_hash":"0xabc","chain_id":"playground-local","input_hash":"seed"},' +
        '"metering":true,"chi_budget":5000}',
    );
  });

  it("deploys source with constructor args and leaves out empty environment fields", async () => {
    const { engine, chains } = setup();
    await engine.deploy({
      signer: "demo",
      name: "con_a",
      source: "x = 1",
      constructorKwargs: '{"n":1}',
      environment: { now: "", blockNum: "", blockHash: "", chainId: "", inputHash: "" },
      metering: { enabled: false, chiLimit: "5000" },
    });
    expect(chains[0]!.sent[0]).toBe(
      '{"sender":"demo","name":"con_a","source":"x = 1","constructor_args":{"n":1},"environment":{},"metering":false}',
    );
  });

  it("maps a successful outcome", async () => {
    const { engine, chains } = setup();
    chains[0]!.reply = JSON.stringify({
      status: 0,
      result: '{"__fixed__":"1.5"}',
      error: null,
      chi_used: 1234,
      writes: [["con_a.v", '{"__big_int__":"9007199254740993"}'], ["con_a.w", null]],
      events: [{ contract: "con_a", event: "Moved", signer: '"alice"', caller: '"alice"', data_indexed: '{"to":"bob"}', data: '{"amount":1}' }],
    });
    const outcome = await engine.call({ signer: "a", contract: "con_a", function: "f", kwargs: "{}", environment: env, metering: metered });
    expect(outcome).toEqual({
      ok: true,
      rejected: false,
      result: '{"__fixed__":"1.5"}',
      error: null,
      chiUsed: 1234,
      writes: [
        { key: "con_a.v", value: '{"__big_int__":"9007199254740993"}' },
        { key: "con_a.w", value: null },
      ],
      events: [{ contract: "con_a", event: "Moved", signer: '"alice"', caller: '"alice"', dataIndexed: '{"to":"bob"}', data: '{"amount":1}' }],
    });
  });

  it("maps a failed transaction and a refused request", async () => {
    const { engine, chains } = setup();
    chains[0]!.reply = '{"status":1,"result":"\\"Insufficient balance.\\"","error":"Insufficient balance.","chi_used":20,"writes":[],"events":[]}';
    const failed = await engine.call({ signer: "a", contract: "con_a", function: "f", kwargs: "{}", environment: env, metering: metered });
    expect(failed).toMatchObject({ ok: false, rejected: false, error: "Insufficient balance.", result: null, chiUsed: 20 });
    const refused = await engine.call({ signer: "a", contract: "con_a", function: "f", kwargs: '{"x":"boom"}', environment: env, metering: metered });
    expect(refused).toMatchObject({ ok: false, rejected: true, error: "kwargs refused: fractional number" });
  });

  it("reports an invalid chi budget as a refused request", async () => {
    const { engine } = setup();
    const outcome = await engine.call({ signer: "a", contract: "con_a", function: "f", kwargs: "{}", environment: env, metering: { enabled: true, chiLimit: "0" } });
    expect(outcome).toMatchObject({ ok: false, rejected: true, error: expect.stringMatching(/chi budget/) });
  });

  it("reads contracts and state, writes and deletes keys", async () => {
    const { engine } = setup();
    expect(await engine.contracts()).toEqual([{ name: "con_a", source: "x = 1", vmIrJson: "{}" }]);
    await engine.writeState([{ key: "con_a.v", value: "1" }, { key: "con_a.w", value: '"x"' }]);
    await engine.writeState([{ key: "con_a.w", value: null }]);
    expect(await engine.state()).toEqual([{ key: "con_a.v", value: "1" }]);
    await engine.removeContract("con_a");
    expect(await engine.state()).toEqual([]);
  });

  it("replaces and frees the chain on import and reset", async () => {
    const { engine, chains } = setup();
    await engine.importSnapshot("S");
    expect(chains[0]!.freed).toBe(true);
    expect(JSON.parse(await engine.exportSnapshot()).label).toBe("imported:S");
    await engine.reset();
    expect(chains[1]!.freed).toBe(true);
    expect(JSON.parse(await engine.exportSnapshot()).label).toBe("fresh");
  });
});
