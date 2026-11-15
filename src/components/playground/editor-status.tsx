"use client";

import { ChevronDown, CircleAlert, CircleCheck, Loader2, Rocket, ScanSearch, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { contractNameError } from "@/lib/contract/names";
import type { Diagnostic } from "@/lib/engine/compiler";
import { cn } from "@/lib/utils";

import { useController, usePlayground } from "./context";
import { SectionLabel } from "./panel";

/** The contract name field with the submission rules checked as you type. */
export function NameField() {
  const controller = useController();
  const contractName = usePlayground((state) => state.doc.editor.contractName);
  const signer = usePlayground((state) => state.doc.environment.signer);
  const id = useId();
  const error = contractName === "" ? null : contractNameError(contractName.trim(), signer);
  return (
    <div className="grid gap-1 border-b px-4 py-2.5">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="shrink-0 text-xs font-medium text-muted-foreground">
          Contract name
        </label>
        <Input
          id={id}
          value={contractName}
          onChange={(event) => controller.setEditor({ contractName: event.target.value })}
          placeholder="con_my_contract"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-7 font-mono text-[0.8rem]"
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="text-xs text-error-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

/** Compiler problems; choosing one moves the editor cursor there. */
export function ProblemsList({ diagnostics, onReveal }: { diagnostics: Diagnostic[]; onReveal(item: Diagnostic): void }) {
  return (
    <ul className="max-h-40 overflow-auto" aria-label="Compiler problems">
      {diagnostics.map((item, index) => (
        <li key={`${item.code}-${item.line}-${item.column}-${index}`}>
          <button
            type="button"
            onClick={() => onReveal(item)}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <SeverityIcon severity={item.severity} />
            <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
              Ln {item.line}, Col {item.column}
            </span>
            <span className="min-w-0 flex-1">{item.message}</span>
            <span className="shrink-0 font-mono text-muted-foreground">{item.code}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SeverityIcon({ severity }: { severity: Diagnostic["severity"] }) {
  return severity === "error" ? (
    <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-error-foreground" aria-label="Error" />
  ) : (
    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" aria-label="Warning" />
  );
}

/** Re-check the code and say what was found (the old playground's "Run Linter"). */
export function LintButton({ diagnostics, onLint }: { diagnostics: Diagnostic[]; onLint(): void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        onLint();
        const count = diagnostics.length;
        if (count === 0) toast.success("No problems found.");
        else toast.warning(`Found ${count} ${count === 1 ? "problem" : "problems"}.`);
      }}
    >
      <ScanSearch />
      Lint
    </Button>
  );
}

/** The outcome of the last deploy, next to the button that started it. */
function deployMessage(contract: string, ok: boolean, error: string | null): string {
  return ok ? `Deployed ${contract}.` : `Deploy of ${contract} failed: ${error ?? "unknown error"}`;
}

export function DeployStatus() {
  const run = usePlayground((state) => (state.lastRun?.kind === "deploy" ? state.lastRun : null));
  if (!run) return null;
  const { ok, error, chiUsed } = run.outcome;
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <div
      role={ok ? "status" : "alert"}
      data-testid="deploy-status"
      className={cn("flex items-start gap-2 border-t px-4 py-2 text-xs", ok ? "bg-success-muted text-success-foreground" : "bg-error-muted text-error-foreground")}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{deployMessage(run.contract, ok, error)}</span>
      {run.metered && <span className="shrink-0 tabular-nums">{chiUsed.toLocaleString("en-US")} chi used</span>}
    </div>
  );
}

export function ProblemSummary({ checking, diagnostics }: { checking: boolean; diagnostics: Diagnostic[] }) {
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.length - errors;
  if (checking) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking…
      </span>
    );
  }
  if (errors + warnings === 0) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-success-foreground" role="status">
        <CircleCheck className="size-3.5" aria-hidden /> No problems
      </span>
    );
  }
  return (
    <span className="flex items-center gap-3 text-xs" role="status">
      {errors > 0 && (
        <span className="flex items-center gap-1 text-error-foreground">
          <CircleAlert className="size-3.5" aria-hidden /> {errors} {errors === 1 ? "error" : "errors"}
        </span>
      )}
      {warnings > 0 && (
        <span className="flex items-center gap-1 text-warning-foreground">
          <TriangleAlert className="size-3.5" aria-hidden /> {warnings} {warnings === 1 ? "warning" : "warnings"}
        </span>
      )}
    </span>
  );
}

export function Collapsible({ open, onToggle, label, children }: { open: boolean; onToggle(): void; label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="border-t">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
      >
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden />
        <SectionLabel>{label}</SectionLabel>
      </button>
      <div id={id} hidden={!open} className="px-4 pb-3">
        {children}
      </div>
    </div>
  );
}

/** Cmd/Ctrl+Enter inside `container` (the code editor) runs `action`. */
export function useModEnterWithin(container: string, action: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modEnter = (event.metaKey || event.ctrlKey) && event.key === "Enter";
      if (!modEnter || !(event.target as Element | null)?.closest?.(container)) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [container, action]);
}

/** Deploy the editor contract; `buildConstructorKwargs` returns wire JSON text or null when the form has errors. */
export function DeployButton({ buildConstructorKwargs }: { buildConstructorKwargs(): string | null }) {
  const controller = useController();
  const busy = usePlayground((state) => state.busy);
  const starting = usePlayground((state) => state.engine !== "ready");
  const deploy = useCallback(() => {
    const constructorKwargs = buildConstructorKwargs();
    if (constructorKwargs === null) toast.error("Check the constructor arguments.");
    else void controller.deploy(constructorKwargs);
  }, [controller, buildConstructorKwargs]);
  useModEnterWithin("[data-testid='code-editor']", deploy);

  const label = starting ? "Starting VM…" : busy === "deploy" ? "Deploying…" : "Deploy";
  return (
    <Button size="sm" onClick={deploy} disabled={busy !== null || starting} aria-keyshortcuts="Control+Enter Meta+Enter">
      {label === "Deploy" ? <Rocket /> : <Loader2 className="animate-spin" />}
      {label}
      <Kbd aria-hidden className="ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">
        ⌘↵
      </Kbd>
    </Button>
  );
}
