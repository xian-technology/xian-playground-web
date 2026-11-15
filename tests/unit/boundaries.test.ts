/**
 * Boundary and fallback cases found by mutation testing (mutator on src/lib):
 * each test pins a rule whose off-by-one or missing-default variant would
 * otherwise pass the suite.
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import { parseField } from "@/lib/contract/kwargs";
import { extractMethods } from "@/lib/contract/methods";
import { resolveSelection } from "@/lib/playground/selection";
import { groupState, splitKey } from "@/lib/playground/state-doc";
import { describeWire, formatInline } from "@/lib/values/display";
import { parseJson, stringifyJson } from "@/lib/values/json";
import { appendLog, MAX_LOG_DETAIL, summarizeStateChanges } from "@/lib/workspace/log";
import { defaultWorkspace, MAX_SOURCE_BYTES, parseWorkspaceDoc } from "@/lib/workspace/model";
import { createWorkspaceStore, defaultUiPrefs } from "@/lib/workspace/persistence";
import { decodeShareFragment, MAX_SHARE_FRAGMENT_CHARS, MAX_SHARE_JSON_BYTES, SHARE_PREFIX } from "@/lib/workspace/share";
import { sourceJsonToWire } from "@/lib/values/wire";

const field = (type: Parameters<typeof parseField>[0], text: string) => stringifyJson(parseField(type, text));

describe("datetime and timedelta limits", () => {
  it("accepts the first and last valid date and time parts", () => {
    expect(field("datetime", "0001-01-01")).toBe('{"__time__":[1,1,1,0,0,0,0]}');
    expect(field("datetime", "2024-12-31T23:59:59.999999")).toBe('{"__time__":[2024,12,31,23,59,59,999999]}');
    expect(field("datetime", "2024-01-31")).toBe('{"__time__":[2024,1,31,0,0,0,0]}');
  });

  it("refuses each out-of-range part on its own", () => {
    for (const text of ["0000-01-01", "2024-00-10", "2024-01-00", "2024-04-31", "2024-01-01T12:60", "2024-01-01T12:00:60"]) {
      expect(() => field("datetime", text), text).toThrow(/does not exist/);
    }
  });

  it("normalizes whole days and bounds the duration", () => {
    expect(field("timedelta", "-86400")).toBe('{"__delta__":[-1,0]}');
    expect(field("timedelta", "0")).toBe('{"__delta__":[0,0]}');
    expect(field("timedelta", String(999_999_999 * 86_400))).toBe('{"__delta__":[999999999,0]}');
    expect(field("timedelta", String(-999_999_999 * 86_400))).toBe('{"__delta__":[-999999999,0]}');
    expect(() => field("timedelta", String(1_000_000_000 * 86_400))).toThrow(/too long/);
    expect(() => field("timedelta", String(-1_000_000_000 * 86_400))).toThrow(/too long/);
  });

  it("tells dicts from runtime wrappers", () => {
    expect(field("dict", '{"__note__": 1, "b": 2}')).toBe('{"__note__":1,"b":2}');
    expect(() => field("dict", '{"__fixed__": "1"}')).toThrow(/JSON object/);
  });
});

describe("number and JSON limits", () => {
  it("keeps the largest safe integers bare", () => {
    expect(stringifyJson(sourceJsonToWire("[-9007199254740991, 9007199254740991]"))).toBe("[-9007199254740991,9007199254740991]");
  });

  it("limits object nesting like array nesting", () => {
    expect(() => parseJson('{"a":'.repeat(65) + "1" + "}".repeat(65))).toThrow(/nested/);
    expect(() => parseJson('{"a":'.repeat(64) + "1" + "}".repeat(64))).not.toThrow();
  });

  it("indents nested arrays one level deeper", () => {
    expect(stringifyJson(parseJson("[[1]]"), 2)).toBe("[\n  [\n    1\n  ]\n]");
  });

  it("renders tiny scaled decimals in sets", () => {
    expect(formatInline(describeWire('{"__set__":{"codec":"xian-set-1","items":[["fixed","5"]]}}'))).toBe(
      "{0.000000000000000000000000000005}",
    );
  });
});

describe("contract signatures", () => {
  const ir = (functions: unknown) => JSON.stringify({ functions });

  it("sorts exports by name whatever the source order", () => {
    const fn = (name: string) => ({ name, visibility: "export", parameters: [] });
    expect(extractMethods(ir([fn("c"), fn("a"), fn("b")])).exports.map((m) => m.name)).toEqual(["a", "b", "c"]);
  });

  it("copes with missing keys", () => {
    expect(extractMethods("{}")).toEqual({ constructor: null, exports: [] });
    expect(extractMethods(ir([{ name: "f", visibility: "export" }])).exports[0]?.params).toEqual([]);
    const noValue = { name: "x", annotation: "int", default: { node: "constant", value_type: "int" } };
    expect(extractMethods(ir([{ name: "f", visibility: "export", parameters: [noValue] }])).exports[0]?.params[0]?.defaultText).toBe(
      "expression",
    );
  });
});

describe("state keys", () => {
  it("splits at the first dot only", () => {
    expect(splitKey("con_a.b.c")).toEqual({ contract: "con_a", key: "b.c" });
    expect(splitKey("a.b")).toEqual({ contract: "a", key: "b" });
    expect(splitKey(".v")).toEqual({ contract: "", key: "v" });
    expect(splitKey("con_a")).toEqual({ contract: "con_a", key: "" });
  });

  it("orders contracts and keys", () => {
    const entries = ["con_c.z", "con_a.y", "con_c.a", "con_b.m", "con_a.b"].map((key) => ({ key, value: "1" }));
    expect(groupState(entries, false).map((g) => [g.contract, g.entries.map((e) => e.key)])).toEqual([
      ["con_a", ["b", "y"]],
      ["con_b", ["m"]],
      ["con_c", ["a", "z"]],
    ]);
  });

  it("selects the saved function by name", () => {
    const methods = { constructor: null, exports: ["f", "g"].map((name) => ({ name, kind: "export" as const, docstring: null, params: [] })) };
    const contracts = [{ name: "con_a", source: "", vmIrJson: "", methods }];
    expect(resolveSelection(contracts, false, "con_a", "g").method?.name).toBe("g");
  });
});

describe("log limits", () => {
  it("keeps a detail of exactly the maximum length", () => {
    expect(appendLog([], { level: "info", action: "a", message: "m", detail: "d".repeat(MAX_LOG_DETAIL) })[0]?.detail).toHaveLength(MAX_LOG_DETAIL);
  });

  it("lists exactly `limit` changes without a remainder line", () => {
    const after = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, String(i)]));
    expect(summarizeStateChanges({}, after, 5).split("\n")).toHaveLength(5);
  });
});

describe("workspace limits", () => {
  const withEditor = (editor: unknown) => ({ ...defaultWorkspace(), editor });

  it("requires objects, not arrays or null", () => {
    expect(() => parseWorkspaceDoc(withEditor(null))).toThrow(/editor must be an object/);
    expect(() => parseWorkspaceDoc(withEditor([]))).toThrow(/editor must be an object/);
  });

  it("accepts a source of exactly the compiler limit", () => {
    expect(parseWorkspaceDoc(withEditor({ code: "x".repeat(MAX_SOURCE_BYTES), contractName: "con_x" })).editor.code).toHaveLength(MAX_SOURCE_BYTES);
    expect(() => parseWorkspaceDoc(withEditor({ code: "x".repeat(MAX_SOURCE_BYTES + 1), contractName: "con_x" }))).toThrow(/over 128 KB/);
  });

  it("starts with system contracts hidden and storage available", async () => {
    expect(defaultUiPrefs().showSystemContracts).toBe(false);
    const store = createWorkspaceStore("db-boundaries");
    expect(store.available()).toBe(true);
    await store.save("not a workspace" as never);
    expect(await store.load()).toBeNull();
    await store.save({ doc: defaultWorkspace(), ui: "nope" as never, log: [], snapshot: null });
    expect((await store.load())?.ui).toEqual(defaultUiPrefs());
    await store.save({ doc: defaultWorkspace(), ui: null as never, log: [], snapshot: null });
    expect((await store.load())?.ui).toEqual(defaultUiPrefs());
  });
});

async function deflate(bytes: Uint8Array): Promise<string> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new CompressionStream("deflate-raw"));
  return Buffer.from(await new Response(stream).arrayBuffer()).toString("base64url");
}

describe("share link limits", () => {
  it("reads a link of exactly the maximum length as a link (not as too large)", async () => {
    await expect(decodeShareFragment(SHARE_PREFIX + "A".repeat(MAX_SHARE_FRAGMENT_CHARS - SHARE_PREFIX.length))).rejects.toThrow(/damaged/);
  });

  it("opens a workspace that inflates to exactly the cap", async () => {
    const json = JSON.stringify(defaultWorkspace());
    const padded = json + " ".repeat(MAX_SHARE_JSON_BYTES - new TextEncoder().encode(json).length);
    expect(await decodeShareFragment(SHARE_PREFIX + (await deflate(new TextEncoder().encode(padded))))).toEqual(defaultWorkspace());
  });

  it("refuses text that is not valid UTF-8", async () => {
    const json = new TextEncoder().encode(JSON.stringify({ ...defaultWorkspace(), editor: { code: "X", contractName: "con_x" } }));
    const index = json.indexOf(0x58);
    json[index] = 0xff;
    await expect(decodeShareFragment(SHARE_PREFIX + (await deflate(json)))).rejects.toThrow(/damaged/);
  });
});
