// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook, screen, within } from "@testing-library/react";
import { Database } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ActivityLog } from "@/components/playground/activity-log";
import { DeployStatus, NameField, ProblemsList, ProblemSummary } from "@/components/playground/editor-status";
import { KwargsForm } from "@/components/playground/kwargs-form";
import { MaximizeContext, Panel } from "@/components/playground/panel";
import { ResultView } from "@/components/playground/result-view";
import { useKwargs } from "@/components/playground/use-kwargs";
import { WireValue } from "@/components/playground/wire-value";
import type { ContractMethod } from "@/lib/contract/methods";
import type { RunRecord } from "@/lib/playground/controller";

import { installDomShims, renderWith, startController } from "./support/dom";

beforeAll(installDomShims);
afterEach(cleanup);

const transfer: ContractMethod = {
  name: "transfer",
  kind: "export",
  docstring: "Move tokens.",
  params: [
    { name: "to", type: "str", annotation: "str", required: true, defaultText: null, keywordOnly: false },
    { name: "amount", type: "decimal", annotation: "decimal", required: true, defaultText: null, keywordOnly: false },
    { name: "memo", type: "dict", annotation: "dict", required: false, defaultText: "None", keywordOnly: true },
  ],
};

const run = (patch: Partial<RunRecord["outcome"]>, extra: Partial<RunRecord> = {}): RunRecord => ({
  kind: "call",
  contract: "con_a",
  function: "f",
  kwargs: "{}",
  metered: true,
  at: "2026-11-15T00:00:00.000Z",
  outcome: { ok: true, rejected: false, result: "null", error: null, chiUsed: 0, writes: [], events: [], ...patch },
  ...extra,
});

describe("KwargsForm", () => {
  it("shows an untouched field named constructor as empty without a prototype error", async () => {
    const param = { ...transfer.params[0]!, name: "constructor", required: false, defaultText: "'default'" };
    renderWith(await startController(), <KwargsForm method={{ ...transfer, params: [param] }} values={{}} errors={{}} onChange={() => {}} />);
    expect((screen.getByLabelText("constructor") as HTMLInputElement).value).toBe("");
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
  it("shows each parameter with its type, defaults and errors, and submits on Enter", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const controller = await startController();
    renderWith(
      controller,
      <KwargsForm method={transfer} values={{ to: "bob" }} errors={{ amount: "Enter a decimal such as 1.5." }} onChange={onChange} onSubmit={onSubmit} />,
    );
    expect(screen.getByLabelText("to")).toHaveProperty("value", "bob");
    expect(screen.getByText("decimal")).toBeTruthy();
    expect(screen.getByText("keyword-only")).toBeTruthy();
    expect(screen.getByText(/Leave empty to use the default/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Enter a decimal such as 1.5.");
    expect(screen.getByLabelText("amount").getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(screen.getByLabelText("amount"), { target: { value: "2.5" } });
    expect(onChange).toHaveBeenCalledWith("amount", "2.5");
    fireEvent.keyDown(screen.getByLabelText("to"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("memo"), { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("offers true, false or the default for an optional bool", async () => {
    const flag = { name: "flag", type: "bool" as const, annotation: "bool", required: false, defaultText: "True", keywordOnly: false };
    renderWith(await startController(), <KwargsForm method={{ ...transfer, params: [flag] }} values={{}} errors={{}} onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "flag" }).textContent).toBe("Use default");
  });

  it("says when a function takes no arguments", async () => {
    renderWith(await startController(), <KwargsForm method={{ ...transfer, params: [] }} values={{}} errors={{}} onChange={() => {}} />);
    expect(screen.getByText("This function takes no arguments.")).toBeTruthy();
  });
});

describe("useKwargs", () => {
  it("does not copy an inherited constructor value into the JSON editor", () => {
    const param = { ...transfer.params[0]!, name: "constructor", required: false, defaultText: "'default'" };
    const { result } = renderHook(() => useKwargs({ ...transfer, params: [param] }, "prototype"));
    act(() => result.current.setMode("json"));
    expect(result.current.jsonText).toBe("{}");
  });
  it("keeps an unset optional string at its default when switching to JSON", () => {
    const param = { ...transfer.params[0]!, name: "recipient", required: false, defaultText: "'treasury'" };
    const { result } = renderHook(() => useKwargs({ ...transfer, params: [param] }, "optional"));
    expect(result.current.build()).toBe("{}");
    act(() => result.current.setMode("json"));
    expect(result.current.build()).toBe("{}");
  });
  it("builds exact kwargs, reports field errors and switches to JSON with the form's values", () => {
    const { result, rerender } = renderHook(({ key }) => useKwargs(transfer, key), { initialProps: { key: "a" } });
    act(() => result.current.setValue("amount", "x"));
    let built: string | null = "";
    act(() => {
      built = result.current.build();
    });
    expect(built).toBeNull();
    expect(result.current.errors.amount).toMatch(/decimal/);
    act(() => result.current.setValue("amount", "0.10"));
    expect(result.current.errors.amount).toBeUndefined();
    act(() => {
      built = result.current.build();
    });
    expect(built).toBe('{"to":"","amount":{"__fixed__":"0.1"}}');
    act(() => result.current.setMode("json"));
    expect(result.current.jsonText).toBe('{\n  "to": "",\n  "amount": {\n    "__fixed__": "0.1"\n  }\n}');
    act(() => result.current.setJsonText("[1]"));
    act(() => {
      built = result.current.build();
    });
    expect(built).toBeNull();
    expect(result.current.jsonError).toMatch(/JSON object/);
    act(() => result.current.setJsonText('{"to": "bob", "amount": 2.50}'));
    act(() => {
      built = result.current.build();
    });
    expect(built).toBe('{"to":"bob","amount":{"__fixed__":"2.5"}}');
    rerender({ key: "b" });
    expect([result.current.mode, result.current.values]).toEqual(["form", {}]);
  });

  it("builds nothing without a method", () => {
    const { result } = renderHook(() => useKwargs(null, "none"));
    expect(result.current.build()).toBeNull();
  });
});

describe("ResultView", () => {
  it("asks for a run before there is one", async () => {
    renderWith(await startController(), <ResultView run={null} />);
    expect(screen.getByText(/Run a function to see its result/)).toBeTruthy();
  });

  it("shows a successful call with its value, chi, writes and events", async () => {
    renderWith(
      await startController(),
      <ResultView
        run={run({
          result: '{"__fixed__":"0.000000000000000000000000000001"}',
          chiUsed: 1234,
          writes: [
            { key: "con_a.v", value: '{"__big_int__":"9007199254740993"}' },
            { key: "con_a.w", value: null },
          ],
          events: [{ contract: "con_a", event: "Moved", signer: '"a"', caller: '"a"', dataIndexed: '{"to":"bob"}', data: '{"amount":1}' }],
        })}
      />,
    );
    expect(screen.getByText("Success")).toBeTruthy();
    expect(screen.getByTestId("return-value").textContent).toContain("0.000000000000000000000000000001");
    expect(screen.getByText("1,234 chi used")).toBeTruthy();
    expect(screen.getByText("9007199254740993")).toBeTruthy();
    expect(screen.getByText("deleted")).toBeTruthy();
    expect(screen.getByText("Moved")).toBeTruthy();
  });

  it("shows failures, refusals and unmetered runs", async () => {
    const controller = await startController();
    const { rerender } = renderWith(controller, <ResultView run={run({ ok: false, result: null, error: "Insufficient balance." }, { metered: false })} />);
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByTestId("run-error").textContent).toBe("Insufficient balance.");
    expect(screen.getByText("not metered")).toBeTruthy();
    rerender(<ResultView run={run({ ok: false, rejected: true, result: null, error: "bad kwargs" }, { kind: "deploy" })} />);
    expect(screen.getByText("Refused")).toBeTruthy();
    expect(screen.getByTestId("run-error").textContent).toBe("The VM refused this request: bad kwargs");
    expect(screen.getByText("deploy con_a")).toBeTruthy();
  });
});

const problem = (severity: "error" | "warning") => ({ severity, code: "C", message: "m", line: 1, column: 1, endLine: 1, endColumn: 2 });

describe("editor status", () => {
  it("summarizes problems", async () => {
    const controller = await startController();
    const { rerender } = renderWith(controller, <ProblemSummary checking diagnostics={[]} />);
    expect(screen.getByRole("status").textContent).toContain("Checking");
    rerender(<ProblemSummary checking={false} diagnostics={[]} />);
    expect(screen.getByRole("status").textContent).toContain("No problems");
    rerender(<ProblemSummary checking={false} diagnostics={[problem("error"), problem("error"), problem("warning")]} />);
    expect(screen.getByRole("status").textContent).toBe(" 2 errors 1 warning");
    rerender(<ProblemSummary checking={false} diagnostics={[problem("error")]} />);
    expect(screen.getByRole("status").textContent).toBe(" 1 error");
  });

  it("lets a problem move the cursor to its line", async () => {
    const onReveal = vi.fn();
    const item = { severity: "warning" as const, code: "W1", message: "unused", line: 4, column: 2, endLine: 4, endColumn: 5 };
    renderWith(await startController(), <ProblemsList diagnostics={[item]} onReveal={onReveal} />);
    fireEvent.click(screen.getByRole("button", { name: /Ln 4, Col 2/ }));
    expect(onReveal).toHaveBeenCalledWith(item);
  });

  it("validates the contract name as you type", async () => {
    const controller = await startController();
    renderWith(controller, <NameField />);
    fireEvent.change(screen.getByLabelText("Contract name"), { target: { value: "Token" } });
    expect(screen.getByText(/Use con_ followed by/)).toBeTruthy();
    expect(controller.getState().doc.editor.contractName).toBe("Token");
  });

  it("shows the last deploy result", async () => {
    const controller = await startController();
    renderWith(controller, <DeployStatus />);
    expect(screen.queryByTestId("deploy-status")).toBeNull();
    await act(() => controller.deploy("{}"));
    expect(screen.getByTestId("deploy-status").textContent).toContain("Deployed con_demo_token.");
    expect(screen.getByTestId("deploy-status").textContent).toContain("10 chi used");
  });
});

describe("WireValue", () => {
  it("labels values with their contract type", async () => {
    renderWith(await startController(), <WireValue text='{"__time__":[2024,2,1,12,30,0,0]}' />);
    expect(screen.getByText("2024-02-01 12:30:00")).toBeTruthy();
    expect(screen.getByText("datetime")).toBeTruthy();
  });
});

describe("ActivityLog", () => {
  it("expands, lists entries newest first and clears them", async () => {
    const controller = await startController();
    await controller.deploy("{}");
    await controller.call("con_demo_token", "f", "{}");
    renderWith(controller, <ActivityLog />);
    const toggle = screen.getByRole("button", { name: /Activity log/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    const items = within(screen.getByRole("list", { name: "Activity log entries" })).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("Ran con_demo_token.f.");
    fireEvent.click(screen.getByRole("button", { name: "Clear log" }));
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
  });
});

describe("Panel", () => {
  it("maximizes and restores with Escape", async () => {
    const toggle = vi.fn();
    const controller = await startController();
    const { rerender } = renderWith(
      controller,
      <MaximizeContext.Provider value={{ maximized: null, toggle }}>
        <Panel id="state" icon={Database} title="Contract state" description="d">
          body
        </Panel>
      </MaximizeContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Maximize Contract state panel" }));
    expect(toggle).toHaveBeenCalledWith("state");
    rerender(
      <MaximizeContext.Provider value={{ maximized: "state", toggle }}>
        <Panel id="state" icon={Database} title="Contract state" description="d">
          body
        </Panel>
      </MaximizeContext.Provider>,
    );
    expect(screen.getByRole("dialog", { name: "Contract state" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(toggle).toHaveBeenCalledTimes(2);
  });
});
