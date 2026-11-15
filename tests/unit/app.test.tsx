// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { defaultWorkspace } from "@/lib/workspace/model";
import { encodeShareFragment } from "@/lib/workspace/share";

import TOKEN_IR from "./fixtures/token_ir.json?raw";
import { installDomShims, MemoryEngine } from "./support/dom";

const engines: MemoryEngine[] = [];
vi.mock("@/lib/engine/create-engine", () => ({
  createBrowserEngine: () => {
    const engine = new MemoryEngine(TOKEN_IR);
    engines.push(engine);
    return engine;
  },
}));
vi.mock("@/lib/workspace/persistence", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/workspace/persistence")>();
  let saved: unknown = null;
  return {
    ...actual,
    createWorkspaceStore: () => ({
      load: async () => saved,
      save: async (workspace: unknown) => ((saved = workspace), true),
      clear: async () => void (saved = null),
      available: () => true,
    }),
  };
});
vi.mock("@/components/playground/editor-panel", () => ({ EditorPanel: () => <div>editor</div> }));
vi.mock("@/components/playground/inspect-panel", () => ({ InspectPanel: () => <div>inspect</div> }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { PlaygroundApp } = await import("@/components/playground/playground-app");
const { TooltipProvider } = await import("@/components/ui/tooltip");

beforeAll(installDomShims);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  history.replaceState(null, "", "/");
});

// Role queries over the whole app are slow in jsdom; allow them time.
configure({ asyncUtilTimeout: 5000 });

const renderApp = () =>
  render(
    <TooltipProvider>
      <PlaygroundApp />
    </TooltipProvider>,
  );

describe("PlaygroundApp", () => {
  it("opens the playground and saves on Cmd/Ctrl+S", async () => {
    renderApp();
    await screen.findByText("Playground");
    await waitFor(() => expect(screen.queryByText(/Starting the Xian VM/)).toBeNull());
    await act(async () => fireEvent.keyDown(window, { key: "s", metaKey: true }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved in this browser."));
  });

  it("asks before opening a share link and then restores it", async () => {
    const doc = defaultWorkspace();
    doc.contracts.push({ name: "con_demo_token", source: doc.editor.code, constructorKwargs: "{}", state: [["balances:bob", "5"]] });
    history.replaceState(null, "", `/${await encodeShareFragment(doc)}`);
    renderApp();
    const open = await screen.findByRole("button", { name: "Open share link" });
    expect(window.location.hash).toBe("");
    await act(async () => fireEvent.click(open));
    await waitFor(() => expect(engines.at(-1)!.store.get("con_demo_token.balances:bob")).toBe("5"));
  });

  it("keeps the workspace when the share link is declined or damaged", async () => {
    history.replaceState(null, "", "/#w=@@@");
    renderApp();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/damaged/)));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("maximizes a panel and makes the rest inert", async () => {
    renderApp();
    const maximize = await screen.findByRole("button", { name: "Maximize Contract state panel" });
    fireEvent.click(maximize);
    expect(screen.getByRole("dialog", { name: "Contract state" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Workspace" }).closest("[inert]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("PlaygroundApp start-up", () => {
  it("uses the resizable desktop layout on wide screens", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...matchMedia(query), matches: true })) as typeof window.matchMedia;
    renderApp();
    expect(await screen.findByRole("separator", { name: "Resize top and bottom rows" })).toBeTruthy();
    window.matchMedia = matchMedia;
  });

  it("offers to start fresh when the saved workspace cannot be loaded", async () => {
    const original = MemoryEngine.prototype.contracts;
    MemoryEngine.prototype.contracts = async () => {
      throw new Error("corrupt snapshot");
    };
    renderApp();
    expect(await screen.findByText("The playground could not start")).toBeTruthy();
    expect(screen.getByText("corrupt snapshot")).toBeTruthy();
    MemoryEngine.prototype.contracts = original;
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start fresh" })));
    expect(await screen.findByText("Playground")).toBeTruthy();
  });
});

describe("AppHeader", () => {
  it("exports, resets and loads examples with undo", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderApp();
    await screen.findByText("Playground");
    await waitFor(() => expect(screen.queryByText(/Starting the Xian VM/)).toBeNull());

    fireEvent.pointerDown(screen.getByRole("button", { name: "More workspace actions" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Export workspace" }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Examples" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Counter/ }));
    expect(toast.success).toHaveBeenCalledWith("Loaded the Counter example.", expect.objectContaining({ action: expect.anything() }));
    const undo = toast.success.mock.calls.at(-1)![1].action.onClick as () => void;
    act(() => undo());

    fireEvent.pointerDown(screen.getByRole("button", { name: "More workspace actions" }), { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Reset workspace/ }));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Reset workspace" })));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Workspace reset."));
  });

  it("copies a share link and imports a workspace file", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp();
    await screen.findByText("Playground");
    await waitFor(() => expect(screen.queryByText(/Starting the Xian VM/)).toBeNull());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Share/ })));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toMatch(/#w=/);
    writeText.mockRejectedValueOnce(new Error("Clipboard blocked."));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Share/ })));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Clipboard blocked."));

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([JSON.stringify(defaultWorkspace())], "ws.json", { type: "application/json" });
    await act(async () => fireEvent.change(input, { target: { files: [file] } }));
    expect(await screen.findByRole("button", { name: "Open file" })).toBeTruthy();
    const huge = new File(["x"], "huge.json");
    Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 });
    await act(async () => fireEvent.change(input, { target: { files: [huge] } }));
    expect(toast.error).toHaveBeenCalledWith("This file is larger than 10 MB.");
    const bad = new File(["{"], "bad.json");
    await act(async () => fireEvent.change(input, { target: { files: [bad] } }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Could not read bad.json/)));
  });
});
