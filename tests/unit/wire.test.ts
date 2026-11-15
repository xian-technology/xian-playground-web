import { describe, expect, it } from "vitest";

import { parseJson, stringifyJson } from "@/lib/values/json";
import { sourceJsonToWire, parseWireJson } from "@/lib/values/wire";

const wire = (text: string) => stringifyJson(sourceJsonToWire(text));

describe("sourceJsonToWire (user-typed JSON to exact wire JSON)", () => {
  it("turns bare decimals into canonical __fixed__ wrappers", () => {
    expect(wire('{"amount": 1.50, "rate": 2e-3}')).toBe(
      '{"amount":{"__fixed__":"1.5"},"rate":{"__fixed__":"0.002"}}',
    );
  });

  it("turns unsafe integers into __big_int__ and keeps safe ones bare", () => {
    expect(wire("[9007199254740991, 9007199254740992, -9007199254740992]")).toBe(
      '[9007199254740991,{"__big_int__":"9007199254740992"},{"__big_int__":"-9007199254740992"}]',
    );
  });

  it("accepts canonical wrappers and rejects noncanonical ones", () => {
    expect(wire('{"__fixed__":"1.5"}')).toBe('{"__fixed__":"1.5"}');
    expect(() => wire('{"__fixed__":"1.50"}')).toThrow(/__fixed__/);
    expect(() => wire('{"__big_int__":"5"}')).toThrow(/__big_int__/);
    expect(() => wire('{"__fixed__":"1","x":1}')).toThrow(/single key/);
    expect(() => wire('{"__bytes__":"zz"}')).toThrow(/__bytes__/);
    expect(() => wire('{"__time__":[2024,1]}')).toThrow(/__time__/);
    expect(wire('{"__time__":[2024,2,1,12,30,0,0]}')).toBe('{"__time__":[2024,2,1,12,30,0,0]}');
    expect(wire('{"__delta__":[1,30]}')).toBe('{"__delta__":[1,30]}');
  });

  it("checks every wrapper's payload shape", () => {
    for (const bad of [
      '{"__set__":[1]}',
      '{"__frozenset__":"x"}',
      '{"__bytearray__":"abc"}',
      '{"__bytes__":5}',
      '{"__time__":[2024,1,1.5]}',
      '{"__time__":"2024"}',
      '{"__delta__":[1,9007199254740992]}',
      '{"__delta__":[1,"2"]}',
      '{"__big_int__":5}',
      '{"__fixed__":1.5}',
      '{"__big_int__":"01"}',
    ]) {
      expect(() => wire(bad), bad).toThrow(/__/);
    }
    expect(wire('{"__bytearray__":"0aFF"}')).toBe('{"__bytearray__":"0aFF"}');
    expect(wire('{"__frozenset__":{"codec":"xian-set-1","items":[]}}')).toBe('{"__frozenset__":{"codec":"xian-set-1","items":[]}}');
  });

  it("rejects integers beyond 512 bits", () => {
    expect(() => wire((1n << 512n).toString())).toThrow(/512/);
  });

  it("rejects decimals outside the VM range", () => {
    expect(() => wire("1e61")).toThrow(/10\^61/);
    expect(() => wire("1e-31")).toThrow(/30 fractional/);
  });
});

describe("parseWireJson (values coming back from the VM)", () => {
  it("accepts canonical wire JSON", () => {
    const text = '{"a":{"__fixed__":"1.5"},"b":{"__big_int__":"9007199254740992"},"c":[1,"x",null,true]}';
    expect(stringifyJson(parseWireJson(text))).toBe(text);
  });

  it("refuses bare decimals and unsafe bare integers instead of rounding them", () => {
    expect(() => parseWireJson("1.5")).toThrow(/bare decimal/);
    expect(() => parseWireJson("9007199254740992")).toThrow(/__big_int__/);
  });

  it("round trips through parseJson unchanged", () => {
    const text = '{"__set__":{"codec":"xian-set-1","items":[["int","1"]]}}';
    expect(stringifyJson(parseWireJson(text))).toBe(stringifyJson(parseJson(text)));
  });
});
