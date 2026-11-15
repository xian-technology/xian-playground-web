import { describe, expect, it } from "vitest";

import { buildStateDocument, groupState, planStateEdit, restoreWrites, toPortableContracts } from "@/lib/playground/state-doc";
import { stringifyJson } from "@/lib/values/json";

const entries = [
  { key: "con_b.v", value: '"x"' },
  { key: "con_a.balances:bob", value: "5" },
  { key: "con_a.balances:alice", value: '{"__fixed__":"1.5"}' },
  { key: "con_a.__code__", value: '"source"' },
  { key: "submission.__code__", value: '"s"' },
];

describe("buildStateDocument", () => {
  it("groups keys by contract, sorted, hiding protected keys by default", () => {
    expect(stringifyJson(buildStateDocument(entries, false))).toBe(
      '{"con_a":{"balances:alice":{"__fixed__":"1.5"},"balances:bob":5},"con_b":{"v":"x"}}',
    );
  });

  it("includes protected keys when asked", () => {
    const doc = stringifyJson(buildStateDocument(entries, true));
    expect(doc).toContain('"__code__":"source"');
    expect(doc).toContain('"submission"');
  });

  it("groups entries for the tree view", () => {
    expect(groupState(entries, false).map((g) => [g.contract, g.entries.map((e) => e.key)])).toEqual([
      ["con_a", ["balances:alice", "balances:bob"]],
      ["con_b", ["v"]],
    ]);
  });
});

describe("planStateEdit", () => {
  const deployed = ["con_a", "con_b"];

  it("writes changed keys, deletes removed public keys and leaves the rest", () => {
    const edited = '{"con_a": {"balances:alice": 2.25, "balances:carol": 7}, "con_b": {"v": "x"}}';
    expect(planStateEdit(entries, deployed, edited)).toEqual([
      { key: "con_a.balances:alice", value: '{"__fixed__":"2.25"}' },
      { key: "con_a.balances:carol", value: "7" },
      { key: "con_a.balances:bob", value: null },
    ]);
  });

  it("ignores protected keys and contracts not mentioned", () => {
    expect(planStateEdit(entries, deployed, '{"con_b": {"v": "y", "__code__": "evil"}}')).toEqual([
      { key: "con_b.v", value: '"y"' },
    ]);
  });

  it("treats null as delete", () => {
    expect(planStateEdit(entries, deployed, '{"con_b": {"v": null}}')).toEqual([{ key: "con_b.v", value: null }]);
  });

  it("rejects unknown contracts, system contracts and malformed shapes", () => {
    expect(() => planStateEdit(entries, deployed, '{"con_zz": {}}')).toThrow(/con_zz is not deployed/);
    expect(() => planStateEdit(entries, deployed, '{"submission": {"x": 1}}')).toThrow(/submission/);
    expect(() => planStateEdit(entries, deployed, "[]")).toThrow(/object/);
    expect(() => planStateEdit(entries, deployed, '{"con_a": 5}')).toThrow(/con_a/);
    expect(() => planStateEdit(entries, deployed, "{")).toThrow(/JSON/);
  });
});

describe("portable contracts", () => {
  it("exports public state per contract in deploy order", () => {
    const meta = [
      { name: "con_b", source: "b", constructorKwargs: "{}" },
      { name: "con_a", source: "a", constructorKwargs: '{"n":1}' },
    ];
    expect(toPortableContracts(meta, entries)).toEqual([
      { name: "con_b", source: "b", constructorKwargs: "{}", state: [["v", '"x"']] },
      {
        name: "con_a",
        source: "a",
        constructorKwargs: '{"n":1}',
        state: [
          ["balances:alice", '{"__fixed__":"1.5"}'],
          ["balances:bob", "5"],
        ],
      },
    ]);
  });

  it("restores provided keys and removes public keys the export did not have", () => {
    expect(restoreWrites("con_a", [["balances:alice", "9"]], entries)).toEqual([
      { key: "con_a.balances:alice", value: "9" },
      { key: "con_a.balances:bob", value: null },
    ]);
  });
});
