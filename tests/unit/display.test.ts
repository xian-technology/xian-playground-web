import { describe, expect, it } from "vitest";

import { describeWire, formatInline } from "@/lib/values/display";

const show = (text: string) => formatInline(describeWire(text));

describe("describeWire / formatInline (display never changes a value)", () => {
  it("shows decimals and big integers digit for digit", () => {
    expect(describeWire('{"__fixed__":"0.000000000000000000000000000001"}')).toEqual({
      kind: "scalar",
      type: "decimal",
      text: "0.000000000000000000000000000001",
    });
    expect(show('{"__big_int__":"123456789012345678901234567890"}')).toBe("123456789012345678901234567890");
    expect(show("9007199254740991")).toBe("9007199254740991");
  });

  it("shows strings, booleans and None like contract code would", () => {
    expect(show('"bob"')).toBe('"bob"');
    expect(show("true")).toBe("True");
    expect(show("null")).toBe("None");
  });

  it("shows runtime wrappers readably", () => {
    expect(show('{"__time__":[2024,2,1,12,30,0,0]}')).toBe("2024-02-01 12:30:00");
    expect(show('{"__time__":[2024,2,1,12,30,5,120]}')).toBe("2024-02-01 12:30:05.000120");
    expect(show('{"__delta__":[1,3661]}')).toBe("1 day, 1:01:01");
    expect(show('{"__delta__":[-1,86399]}')).toBe("-1 day, 23:59:59");
    expect(show('{"__bytes__":"00ff"}')).toBe("0x00ff");
  });

  it("shows nested containers inline", () => {
    expect(show('{"a":[1,{"__fixed__":"2.5"}],"b":{}}')).toBe('{"a": [1, 2.5], "b": {}}');
  });

  it("shows sets from their typed members", () => {
    expect(show('{"__set__":{"codec":"xian-set-1","items":[["int","1"],["str","a"],["fixed","1500000000000000000000000000000"],["none"],["bool",false]]}}')).toBe(
      '{1, "a", 1.5, None, False}',
    );
    expect(show('{"__frozenset__":{"codec":"xian-set-1","items":[]}}')).toBe("frozenset()");
  });

  it("shows every typed set member kind", () => {
    const members = [
      '["bytes","00ff"]',
      '["datetime",[2024,2,1,12,30,0,0]]',
      '["timedelta","90061"]',
      '["tuple",[["int","1"],["str","a"]]]',
      '["frozenset",[["int","2"]]]',
      '["mystery","x"]',
      '"loose"',
    ];
    expect(show(`{"__set__":{"codec":"xian-set-1","items":[${members.join(",")}]}}`)).toBe(
      '{0x00ff, 2024-02-01 12:30:00, 1 day, 1:01:01, [1, "a"], frozenset({2}), ["mystery","x"], "loose"}',
    );
    expect(show('{"__frozenset__":{"codec":"xian-set-1","items":[["fixed","-2500000000000000000000000000000"]]}}')).toBe(
      "frozenset({-2.5})",
    );
  });

  it("treats malformed wrappers as plain dicts", () => {
    expect(describeWire('{"__set__":{"codec":"xian-set-1","items":5}}').kind).toBe("dict");
    expect(show('{"__bytearray__":"0a"}')).toBe("0x0a");
    expect(describeWire('{"__bytearray__":"0a"}')).toMatchObject({ type: "bytearray" });
    expect(show('{"__repr__":"<contract>"}')).toBe('{"__repr__": "<contract>"}');
  });

  it("falls back to the raw text when the VM output is not valid wire JSON", () => {
    expect(describeWire("1.5")).toEqual({ kind: "scalar", type: "raw", text: "1.5" });
  });
});
