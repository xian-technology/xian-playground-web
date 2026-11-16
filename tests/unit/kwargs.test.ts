import { describe, expect, it } from "vitest";

import { buildKwargs, parseField } from "@/lib/contract/kwargs";
import type { ContractMethod, MethodParam } from "@/lib/contract/methods";
import { stringifyJson } from "@/lib/values/json";

const field = (type: MethodParam["type"], text: string) => stringifyJson(parseField(type, text));

describe("parseField (one typed input to exact wire JSON)", () => {
  it("encodes integers exactly, big ones as __big_int__", () => {
    expect(field("int", "25")).toBe("25");
    expect(field("int", " -7 ")).toBe("-7");
    expect(field("int", "123456789012345678901234567890")).toBe('{"__big_int__":"123456789012345678901234567890"}');
    expect(() => field("int", "1.5")).toThrow(/whole number/);
    expect(() => field("int", "1e3")).toThrow(/whole number/);
  });

  it("encodes decimals as canonical __fixed__ text, never a float", () => {
    expect(field("decimal", "0.1")).toBe('{"__fixed__":"0.1"}');
    expect(field("decimal", "1.50")).toBe('{"__fixed__":"1.5"}');
    expect(field("decimal", "5")).toBe('{"__fixed__":"5"}');
    expect(field("decimal", "0.000000000000000000000000000001")).toBe('{"__fixed__":"0.000000000000000000000000000001"}');
    expect(() => field("decimal", "1,5")).toThrow(/decimal/);
    expect(() => field("decimal", "0.0000000000000000000000000000001")).toThrow(/30/);
  });

  it("passes strings through untouched", () => {
    expect(field("str", "  alice \"q\" ")).toBe('"  alice \\"q\\" "');
  });

  it("encodes booleans", () => {
    expect(field("bool", "true")).toBe("true");
    expect(field("bool", "false")).toBe("false");
    expect(() => field("bool", "yes")).toThrow(/true or false/);
  });

  it("encodes datetimes as __time__ with all seven parts", () => {
    expect(field("datetime", "2024-02-01T12:30:00")).toBe('{"__time__":[2024,2,1,12,30,0,0]}');
    expect(field("datetime", "2024-02-01")).toBe('{"__time__":[2024,2,1,0,0,0,0]}');
    expect(field("datetime", "2024-02-29 23:59:59.5")).toBe('{"__time__":[2024,2,29,23,59,59,500000]}');
    expect(() => field("datetime", "2023-02-29")).toThrow(/date/);
    expect(() => field("datetime", "2024-13-01")).toThrow(/date/);
    expect(() => field("datetime", "2024-01-01T24:00")).toThrow(/time/);
    expect(() => field("datetime", "yesterday")).toThrow(/YYYY-MM-DD/);
  });

  it("encodes timedeltas from whole seconds as normalized [days, seconds]", () => {
    expect(field("timedelta", "90061")).toBe('{"__delta__":[1,3661]}');
    expect(field("timedelta", "-1")).toBe('{"__delta__":[-1,86399]}');
    expect(() => field("timedelta", "1.5")).toThrow(/seconds/);
  });

  it("encodes bytes from hex", () => {
    expect(field("bytes", "00FFab")).toBe('{"__bytes__":"00ffab"}');
    expect(field("bytearray", "")).toBe('{"__bytearray__":""}');
    expect(() => field("bytes", "abc")).toThrow(/hex/);
  });

  it("reads dict, list and Any as exact JSON", () => {
    expect(field("dict", '{"a": 1.25}')).toBe('{"a":{"__fixed__":"1.25"}}');
    expect(field("list", "[1, 2]")).toBe("[1,2]");
    expect(field("any", '"text"')).toBe('"text"');
    expect(() => field("dict", "[1]")).toThrow(/JSON object/);
    expect(() => field("list", "{}")).toThrow(/JSON array/);
    expect(() => field("any", "alice")).toThrow(/quotes/);
  });

  it("accepts ordinary dictionary keys that resemble runtime wrapper names", () => {
    expect(field("dict", '{"__proto__":"payload"}')).toBe('{"__proto__":"payload"}');
    expect(field("dict", '{"__metadata__":1}')).toBe('{"__metadata__":1}');
  });

  it("reads sets as their canonical wire envelope (the VM checks member order)", () => {
    const envelope = '{"__set__":{"codec":"xian-set-1","items":[["int","1"]]}}';
    expect(field("set", envelope)).toBe(envelope);
    expect(() => field("set", "[1, 2]")).toThrow(/__set__/);
    expect(() => field("frozenset", '{"__set__":{"codec":"xian-set-1","items":[]}}')).toThrow(/__frozenset__/);
  });
});

const transfer: ContractMethod = {
  name: "transfer",
  kind: "export",
  docstring: null,
  params: [
    { name: "to", type: "str", annotation: "str", required: true, defaultText: null, keywordOnly: false },
    { name: "amount", type: "int", annotation: "int", required: true, defaultText: null, keywordOnly: false },
    { name: "memo", type: "str", annotation: "str", required: false, defaultText: "''", keywordOnly: false },
  ],
};

describe("buildKwargs", () => {
  it("leaves an untouched optional field named constructor at its default", () => {
    const method = { ...transfer, params: [{ ...transfer.params[2]!, name: "constructor", type: "str" as const }] };
    const result = buildKwargs(method, {});
    expect(result.ok && stringifyJson(result.kwargs)).toBe("{}");
  });

  it("reports a missing __proto__ field as an own error instead of dropping it", () => {
    const method = { ...transfer, params: [{ ...transfer.params[1]!, name: "__proto__" }] };
    const result = buildKwargs(method, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.hasOwn(result.errors, "__proto__")).toBe(true);
      expect(result.errors.__proto__).toBe("Enter a value.");
    }
  });

  it("builds kwargs in parameter order and omits empty optional fields", () => {
    const result = buildKwargs(transfer, { to: "bob", amount: "25", memo: "" });
    expect(result.ok && stringifyJson(result.kwargs)).toBe('{"to":"bob","amount":25}');
  });

  it("keeps an empty required string", () => {
    const result = buildKwargs(transfer, { amount: "1" });
    expect(result.ok && stringifyJson(result.kwargs)).toBe('{"to":"","amount":1}');
  });

  it("reports one message per bad field", () => {
    const result = buildKwargs(transfer, { to: "bob", amount: "" });
    expect(result).toEqual({ ok: false, errors: { amount: "Enter a value." } });
    const bad = buildKwargs(transfer, { to: "bob", amount: "ten" });
    expect(bad.ok ? null : bad.errors.amount).toMatch(/whole number/);
  });
});
