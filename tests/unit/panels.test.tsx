// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CONSTRUCTOR_SOURCE, FLOAT_SOURCE } from "./fixtures/compiler-fixtures";
import TOKEN_IR from "./fixtures/token_ir.json?raw";

import { installDomShims, MemoryEngine, renderWith, startController } from "./support/dom";

// DOM tests run in Vite's browser mode, which cannot load the compiler's
// WebAssembly from disk. This stand-in answers with the real compiler's
// output for known sources (fixtures checked against the compiler in
// compiler.test.ts).
vi.mock("@/lib/engine/compiler", async () => {
  const { CONSTRUCTOR_SOURCE, FLOAT_SOURCE } = await import("./fixtures/compiler-fixtures");
  const constructorIr = (await import("./fixtures/constructor_ir.json?raw")).default;
  const floatDiagnostics = (await import("./fixtures/float_diagnostics.json?raw")).default;
  const { parseDiagnostics, compilerErrorMessage } = await import("@/lib/engine/compiler-output");
  return {
    compilerErrorMessage,
    diagnose: (_name: string, source: string) => (source === FLOAT_SOURCE ? parseDiagnostics(floatDiagnostics) : []),
    compile: (_name: string, source: string) => ({ source, vmIrJson: source === CONSTRUCTOR_SOURCE ? constructorIr : '{"functions":[]}' }),
  };
});
const fakeEditor = vi.hoisted(() => ({
  getModel: () => ({}),
  revealLineInCenter: vi.fn(),
  setPosition: vi.fn(),
  focus: vi.fn(),
}));
const setModelMarkers = vi.hoisted(() => vi.fn());
vi.mock("@monaco-editor/react", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    default: function FakeEditor(props: { value?: string; onChange?(value: string): void; onMount?(editor: unknown): void }) {
      // Monaco calls onMount once, when the editor is created.
      const onMount = useRef(props.onMount);
      useEffect(() => onMount.current?.(fakeEditor), []);
      return <textarea aria-label="code" value={props.value} onChange={(event) => props.onChange?.(event.target.value)} />;
    },
  };
});
vi.mock("@/components/playground/monaco-setup", () => ({
  monaco: { editor: { setModelMarkers }, MarkerSeverity: { Error: 8, Warning: 4, Info: 2 } },
}));

const { EditorPanel } = await import("@/components/playground/editor-panel");
const { EnvironmentSection } = await import("@/components/playground/environment-section");
const { ExecutePanel } = await import("@/components/playground/execute-panel");
const { InspectPanel } = await import("@/components/playground/inspect-panel");
const { StatePanel } = await import("@/components/playground/state-panel");

beforeAll(installDomShims);
afterEach(cleanup);

async function deployed() {
  const engine = new MemoryEngine(TOKEN_IR);
  const controller = await startController(engine);
  await controller.deploy("{}");
  return { engine, controller };
}

describe("ExecutePanel", () => {
  it("invites a deploy when nothing is deployed", async () => {
    renderWith(await startController(), <ExecutePanel />);
    expect(screen.getByText("Nothing to run yet")).toBeTruthy();
  });

  it("runs the selected function with exact kwargs and shows the result", async () => {
    const { controller } = await deployed();
    const call = vi.spyOn(controller, "call");
    renderWith(controller, <ExecutePanel />);
    expect(screen.getByRole("combobox", { name: "Function" }).textContent).toBe("balance_of");
    fireEvent.change(screen.getByLabelText("account"), { target: { value: "bob" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Run/ })));
    expect(call).toHaveBeenCalledWith("con_demo_token", "balance_of", '{"account":"bob"}');
    await waitFor(() => expect(screen.getByTestId("return-value").textContent).toContain('{"account": "bob"}'));
    expect(screen.getByText("demo")).toBeTruthy();
  });

  it("takes raw JSON arguments and explains bad JSON", async () => {
    const { controller } = await deployed();
    const call = vi.spyOn(controller, "call");
    renderWith(controller, <ExecutePanel />);
    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    const box = screen.getByLabelText("Arguments as JSON");
    fireEvent.change(box, { target: { value: "{oops" } });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(screen.getByRole("alert").textContent).toMatch(/Invalid JSON/);
    fireEvent.change(box, { target: { value: '{"account": "eve"}' } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter", ctrlKey: true }));
    expect(call).toHaveBeenCalledWith("con_demo_token", "balance_of", '{"account":"eve"}');
  });
});

describe("StatePanel", () => {
  it("lists keys per contract, filters them and shows raw JSON", async () => {
    const { controller } = await deployed();
    renderWith(controller, <StatePanel />);
    const group = screen.getByRole("region", { name: "con_demo_token state" });
    expect(within(group).getByText("balances:treasury")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter keys"), { target: { value: "nothing" } });
    expect(screen.getByText(/No keys match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "JSON" }));
    expect(screen.getByTestId("state-view").textContent).toContain('"balances:treasury": 1000');
  });

  it("edits state as JSON and can cancel", async () => {
    const { controller, engine } = await deployed();
    renderWith(controller, <StatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit state" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit state" }));
    fireEvent.change(screen.getByLabelText("State as JSON"), { target: { value: '{"con_demo_token": {"balances:treasury": 7}}' } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
    expect(engine.store.get("con_demo_token.balances:treasury")).toBe("7");
    expect(screen.getByRole("button", { name: "Edit state" })).toBeTruthy();
  });

  it("says when there is no state", async () => {
    renderWith(await startController(), <StatePanel />);
    expect(screen.getByText("No state yet")).toBeTruthy();
  });
});

describe("EnvironmentSection", () => {
  it("validates, applies and resets fields", async () => {
    const controller = await startController();
    renderWith(controller, <EnvironmentSection />);
    fireEvent.click(screen.getByRole("button", { name: /Execution environment/ }));
    fireEvent.change(screen.getByLabelText("Block time"), { target: { value: "2023-02-30" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply changes" })));
    expect(screen.getByText("This date does not exist.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Block time"), { target: { value: "2025-01-01T00:00:00" } });
    fireEvent.change(screen.getByLabelText("Signer"), { target: { value: "alice" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply changes" })));
    expect(controller.getState().doc.environment).toMatchObject({ signer: "alice", now: "2025-01-01T00:00:00" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reset Signer to default" })));
    expect(controller.getState().doc.environment.signer).toBe("demo");
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "Count chi like the chain" })));
    expect(controller.getState().doc.metering.enabled).toBe(false);
    expect(screen.getByLabelText("Chi budget")).toHaveProperty("disabled", true);
  });
});

describe("InspectPanel", () => {
  it("shows source or IR and opens a contract in the editor", async () => {
    const { controller } = await deployed();
    controller.setEditor({ code: "x = 1" });
    renderWith(controller, <InspectPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "VM IR" }));
    expect(controller.getState().ui.inspectView).toBe("ir");
    expect((screen.getByLabelText("code") as HTMLTextAreaElement).value).toContain('"functions"');
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(controller.getState().doc.editor.contractName).toBe("con_demo_token");
  });

  it("removes a contract after confirmation", async () => {
    const { controller } = await deployed();
    renderWith(controller, <InspectPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Remove contract" })));
    expect(controller.getState().contracts).toEqual([]);
    expect(screen.getByText("No contracts to inspect")).toBeTruthy();
  });
});

describe("EditorPanel", () => {
  it("edits code, checks it live and deploys with constructor arguments", async () => {
    const controller = await startController(new MemoryEngine(TOKEN_IR));
    const deploy = vi.spyOn(controller, "deploy");
    renderWith(controller, <EditorPanel />);
    fireEvent.change(screen.getByLabelText("code"), { target: { value: CONSTRUCTOR_SOURCE } });
    expect(await screen.findByLabelText("start", {}, { timeout: 3000 })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Deploy" })));
    expect(deploy).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a value.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("start"), { target: { value: "5" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Deploy" })));
    expect(deploy).toHaveBeenCalledWith('{"start":5}');
  });

  it("lists compiler problems", async () => {
    const controller = await startController();
    renderWith(controller, <EditorPanel />);
    fireEvent.change(screen.getByLabelText("code"), { target: { value: FLOAT_SOURCE } });
    const problems = await screen.findByRole("list", { name: "Compiler problems" }, { timeout: 3000 });
    expect(problems.textContent).toContain("float");
    expect(setModelMarkers).toHaveBeenLastCalledWith({}, "xian-compiler", expect.arrayContaining([expect.objectContaining({ severity: 8, startLineNumber: 2 })]));
    fireEvent.click(screen.getByRole("button", { name: "Lint" }));
    fireEvent.click(within(problems).getAllByRole("button")[0]!);
    expect(fakeEditor.revealLineInCenter).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: /Problems/ }));
    expect(problems.closest("[hidden]")).not.toBeNull();
  });

  it("deploys plain code with Cmd/Ctrl+Enter from the editor and shows a failed deploy", async () => {
    const engine = new MemoryEngine(TOKEN_IR);
    engine.deploy = async () => ({ ok: false, rejected: false, result: null, error: "syntax error", chiUsed: 3, writes: [], events: [] });
    const controller = await startController(engine);
    const deploy = vi.spyOn(controller, "deploy");
    renderWith(controller, <EditorPanel />);
    await act(async () => fireEvent.keyDown(screen.getByLabelText("code"), { key: "Enter", ctrlKey: true }));
    expect(deploy).toHaveBeenCalledWith("{}");
    expect(screen.getByTestId("deploy-status").textContent).toContain("Deploy of con_demo_token failed: syntax error");
  });
});
