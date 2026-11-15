import { describe, expect, it } from "vitest";

import { appendLog, MAX_LOG_ENTRIES, MAX_LOG_DETAIL, summarizeStateChanges } from "@/lib/workspace/log";

describe("activity log", () => {
  it("keeps newest entries first and caps the list", () => {
    let entries = appendLog([], { level: "info", action: "deploy", message: "first" });
    entries = appendLog(entries, { level: "success", action: "execute", message: "second" });
    expect(entries.map((e) => e.message)).toEqual(["second", "first"]);
    for (let i = 0; i < MAX_LOG_ENTRIES + 5; i += 1) entries = appendLog(entries, { level: "info", action: "x", message: String(i) });
    expect(entries).toHaveLength(MAX_LOG_ENTRIES);
    expect(entries[0]?.message).toBe(String(MAX_LOG_ENTRIES + 4));
  });

  it("truncates long details", () => {
    const [entry] = appendLog([], { level: "error", action: "x", message: "m", detail: "d".repeat(MAX_LOG_DETAIL + 10) });
    expect(entry?.detail).toHaveLength(MAX_LOG_DETAIL + 1);
    expect(entry?.detail.endsWith("…")).toBe(true);
  });

  it("gives every entry a unique id and an ISO timestamp", () => {
    const entries = appendLog(appendLog([], { level: "info", action: "a", message: "a" }), { level: "info", action: "b", message: "b" });
    expect(entries[0]?.id).not.toBe(entries[1]?.id);
    expect(() => new Date(entries[0]!.at).toISOString()).not.toThrow();
  });
});

describe("summarizeStateChanges", () => {
  it("lists the first changed keys with before and after values", () => {
    const before = { "con_x.a": "1", "con_x.b": "2", "con_x.c": "3" };
    const after = { "con_x.a": "1", "con_x.b": "5", "con_x.d": "4" };
    expect(summarizeStateChanges(before, after)).toBe(
      "con_x.b: 2 -> 5\ncon_x.c: 3 -> (deleted)\ncon_x.d: (unset) -> 4",
    );
  });

  it("limits the summary and says how many more changed", () => {
    const after = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`k${i}`, String(i)]));
    expect(summarizeStateChanges({}, after, 5).split("\n").at(-1)).toBe("… and 2 more changes");
  });

  it("says when nothing changed", () => {
    expect(summarizeStateChanges({ a: "1" }, { a: "1" })).toBe("No keys changed.");
  });
});
