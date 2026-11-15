"use client";

import { Braces, FormInput, Loader2, Play, PlaySquare, Rocket } from "lucide-react";
import { useCallback, useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { resolveSelection } from "@/lib/playground/selection";

import { useController, usePlayground } from "./context";
import { KwargsForm } from "./kwargs-form";
import { Panel, SectionLabel } from "./panel";
import { ResultView } from "./result-view";
import { ContractPicker, EmptyState, SystemContractsSwitch } from "./shared";
import { useKwargs } from "./use-kwargs";

export function ExecutePanel() {
  const controller = useController();
  const contracts = usePlayground((state) => state.contracts);
  const ui = usePlayground((state) => state.ui);
  const busy = usePlayground((state) => state.busy);
  const engineReady = usePlayground((state) => state.engine === "ready");
  const lastRun = usePlayground((state) => state.lastRun);
  const signer = usePlayground((state) => state.doc.environment.signer);
  const metered = usePlayground((state) => state.doc.metering.enabled);
  const selection = resolveSelection(contracts, ui.showSystemContracts, ui.selectedContract, ui.selectedFunction);
  const { contract, method } = selection;
  const kwargs = useKwargs(method, `${contract?.name ?? ""}.${method?.name ?? ""}.${JSON.stringify(method?.params ?? [])}`);
  const functionId = useId();
  const jsonId = useId();

  const run = useCallback(() => {
    if (!contract || !method) return;
    const text = kwargs.build();
    if (text !== null) void controller.call(contract.name, method.name, text);
  }, [contract, method, kwargs, controller]);

  return (
    <Panel id="execute" icon={PlaySquare} title="Execute contract" description="Call an exported function and see what it returns and changes.">
      <div className="flex flex-wrap items-end gap-3 border-b px-4 py-2.5">
        <ContractPicker
          label="Contract"
          contracts={selection.visible}
          value={contract?.name ?? ""}
          onChange={(name) => controller.setUi({ selectedContract: name, selectedFunction: "" })}
        />
        <div className="grid min-w-0 flex-1 gap-1">
          <label htmlFor={functionId} className="text-xs font-medium text-muted-foreground">
            Function
          </label>
          <Select value={method?.name ?? ""} onValueChange={(name) => controller.setUi({ selectedFunction: name })} disabled={!method}>
            <SelectTrigger id={functionId} className="h-8 w-full font-mono text-[0.8rem]">
              <SelectValue placeholder="No functions" />
            </SelectTrigger>
            <SelectContent>
              {(contract?.methods.exports ?? []).map((item) => (
                <SelectItem key={item.name} value={item.name} className="font-mono text-[0.8rem]">
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {!contract ? (
          <EmptyState
            icon={Rocket}
            title="Nothing to run yet"
            description={
              selection.hiddenSystemCount > 0
                ? "Deploy a contract to call its exported functions, or show system contracts."
                : "Deploy a contract to call its exported functions."
            }
          />
        ) : !method ? (
          <p className="text-sm text-muted-foreground">{contract.name} has no exported functions.</p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <SectionLabel>Arguments</SectionLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  value={kwargs.mode}
                  onValueChange={(value) => value && kwargs.setMode(value as "form" | "json")}
                  aria-label="Argument input"
                >
                  <ToggleGroupItem value="form" className="px-2 text-xs" aria-label="Form">
                    <FormInput className="size-3.5" aria-hidden /> Form
                  </ToggleGroupItem>
                  <ToggleGroupItem value="json" className="px-2 text-xs" aria-label="JSON">
                    <Braces className="size-3.5" aria-hidden /> JSON
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {method.docstring && <p className="text-xs text-muted-foreground">{method.docstring}</p>}
              {kwargs.mode === "form" ? (
                <KwargsForm method={method} values={kwargs.values} errors={kwargs.errors} onChange={kwargs.setValue} onSubmit={run} />
              ) : (
                <div className="grid gap-1">
                  <label htmlFor={jsonId} className="sr-only">
                    Arguments as JSON
                  </label>
                  <Textarea
                    id={jsonId}
                    value={kwargs.jsonText}
                    onChange={(event) => kwargs.setJsonText(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        run();
                      }
                    }}
                    spellCheck={false}
                    className="min-h-28 font-mono text-[0.8rem]"
                    aria-invalid={kwargs.jsonError ? true : undefined}
                    aria-describedby={`${jsonId}-help`}
                  />
                  <p id={`${jsonId}-help`} className={kwargs.jsonError ? "text-xs text-error-foreground" : "text-xs text-muted-foreground"} role={kwargs.jsonError ? "alert" : undefined}>
                    {kwargs.jsonError ?? "Numbers stay exact: 1.5 is sent as a decimal, large integers as big ints."}
                  </p>
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <SectionLabel>Result</SectionLabel>
              <ResultView run={lastRun} />
            </div>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <SystemContractsSwitch hiddenCount={selection.hiddenSystemCount} />
        <div className="ml-auto flex items-center gap-2">
          <a href="#environment" className="rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            as <Badge variant="outline" className="font-mono">{signer}</Badge> {metered ? "· metered" : "· unmetered"}
          </a>
          <Button size="sm" onClick={run} disabled={!method || busy !== null || !engineReady} aria-keyshortcuts="Control+Enter Meta+Enter">
            {busy === "call" || !engineReady ? <Loader2 className="animate-spin" /> : <Play />}
            {!engineReady ? "Starting VM…" : busy === "call" ? "Running…" : "Run"}
            <Kbd aria-hidden className="ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">⌘↵</Kbd>
          </Button>
        </div>
      </footer>
    </Panel>
  );
}
