import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";

import { defaultWorkspace } from "@/lib/workspace/model";
import { createWorkspaceStore, defaultUiPrefs, type LocalWorkspace } from "@/lib/workspace/persistence";

const sample = (): LocalWorkspace => ({
  doc: defaultWorkspace(),
  ui: { ...defaultUiPrefs(), selectedContract: "con_demo_token" },
  log: [],
  snapshot: '{"engine":"snapshot"}',
});

describe("workspace persistence", () => {
  it("saves and loads the workspace", async () => {
    const store = createWorkspaceStore("db-1");
    expect(await store.load()).toBeNull();
    expect(await store.save(sample())).toBe(true);
    expect(await store.load()).toEqual(sample());
  });

  it("clears the saved workspace", async () => {
    const store = createWorkspaceStore("db-2");
    await store.save(sample());
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("ignores a stored record that no longer validates", async () => {
    const store = createWorkspaceStore("db-3");
    await store.save({ ...sample(), doc: { ...sample().doc, format: "broken" } as never });
    expect(await store.load()).toBeNull();
  });

  it("falls back to defaults for unknown UI values", async () => {
    const store = createWorkspaceStore("db-ui");
    await store.save({ ...sample(), ui: { ...sample().ui, inspectView: "weird", showProtectedKeys: "yes" } as never });
    const loaded = await store.load();
    expect(loaded?.ui.inspectView).toBe("source");
    expect(loaded?.ui.showProtectedKeys).toBe(false);
  });

  it("keeps working when the browser blocks storage", async () => {
    const spy = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const store = createWorkspaceStore("db-4");
    expect(await store.save(sample())).toBe(false);
    expect(await store.load()).toBeNull();
    expect(store.available()).toBe(false);
    await expect(store.clear()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
