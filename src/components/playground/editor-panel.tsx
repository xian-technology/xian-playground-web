"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { ChevronDown, CircleAlert, CircleCheck, FilePenLine, Loader2, Rocket, ScanSearch, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { contractNameError } from "@/lib/contract/names";
import type { Diagnostic } from "@/lib/engine/compiler";
import { cn } from "@/lib/utils";

import { useController, usePlayground } from "./context";
import { KwargsForm } from "./kwargs-form";
import { monaco } from "./monaco-setup";
import { Panel, SectionLabel } from "./panel";
import { useDiagnostics } from "./use-diagnostics";
import { useKwargs } from "./use-kwargs";

type MonacoEditor = Parameters<OnMount>[0];

const EDITOR_OPTIONS = {
  automaticLayout: true,
  tabSize: 4,
  insertSpaces: true,
  scrollBeyondLastLine: false,
  wordWrap: "on" as const,
  minimap: { enabled: false },
  lineNumbers: "on" as const,
  renderWhitespace: "selection" as const,
  padding: { top: 12, bottom: 12 },
  fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
  fontSize: 13,
  ariaLabel: "Contract source code",
};

const SEVERITY = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
};

export function EditorPanel() {
  const controller = useController();
  const code = usePlayground((state) => state.doc.editor.code);
  const contractName = usePlayground((state) => state.doc.editor.contractName);
  const signer = usePlayground((state) => state.doc.environment.signer);
  const busy = usePlayground((state) => state.busy);
  const engineReady = usePlayground((state) => state.engine === "ready");
  const { resolvedTheme } = useTheme();
  const [revision, setRevision] = useState(0);
  const insight = useDiagnostics(contractName, code, revision);
  const editorRef = useRef<MonacoEditor | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(true);
  const [constructorOpen, setConstructorOpen] = useState(true);
  const nameId = useId();
  const nameError = contractName === "" ? null : contractNameError(contractName.trim(), signer);
  const constructorKey = insight.constructor ? JSON.stringify(insight.constructor.params) : "none";
  const constructorInput = useKwargs(insight.constructor, constructorKey);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      "xian-compiler",
      insight.diagnostics.map((item) => ({
        severity: SEVERITY[item.severity],
        message: `${item.message} (${item.code})`,
        startLineNumber: item.line,
        startColumn: item.column,
        endLineNumber: item.endLine,
        endColumn: Math.max(item.endColumn, item.column + 1),
      })),
    );
  }, [insight.diagnostics]);

  const reveal = useCallback((item: Diagnostic) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(item.line);
    editor.setPosition({ lineNumber: item.line, column: item.column });
    editor.focus();
  }, []);

  const errors = insight.diagnostics.filter((item) => item.severity === "error").length;
  const warnings = insight.diagnostics.length - errors;

  return (
    <Panel
      id="write"
      icon={FilePenLine}
      title="Write contract"
      description="Write a contract, name it con_…, and deploy it to the in-browser chain."
    >
      <div className="grid gap-1 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <label htmlFor={nameId} className="shrink-0 text-xs font-medium text-muted-foreground">
            Contract name
          </label>
          <Input
            id={nameId}
            value={contractName}
            onChange={(event) => controller.setContractName(event.target.value)}
            placeholder="con_my_contract"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            className="h-7 font-mono text-[0.8rem]"
          />
        </div>
        {nameError && (
          <p id={`${nameId}-error`} className="text-xs text-error-foreground">
            {nameError}
          </p>
        )}
      </div>

      <div className="relative min-h-40 flex-1" data-testid="code-editor">
        <Editor
          value={code}
          language="python"
          theme={resolvedTheme === "dark" ? "playground-dark" : "playground-light"}
          options={EDITOR_OPTIONS}
          onChange={(value) => controller.setCode(value ?? "")}
          onMount={(editor) => {
            editorRef.current = editor;
            setRevision((value) => value + 1);
          }}
          loading={<EditorLoading />}
        />
      </div>

      {insight.constructor && insight.constructor.params.length > 0 && (
        <Collapsible
          open={constructorOpen}
          onToggle={() => setConstructorOpen((open) => !open)}
          label={`Constructor arguments · ${insight.constructor.name}()`}
        >
          <KwargsForm
            method={insight.constructor}
            values={constructorInput.values}
            errors={constructorInput.errors}
            onChange={constructorInput.setValue}
          />
        </Collapsible>
      )}

      {insight.diagnostics.length > 0 && (
        <Collapsible
          open={problemsOpen}
          onToggle={() => setProblemsOpen((open) => !open)}
          label={`Problems · ${insight.diagnostics.length}`}
        >
          <ul className="max-h-40 overflow-auto" aria-label="Compiler problems">
            {insight.diagnostics.map((item, index) => (
              <li key={`${item.code}-${item.line}-${item.column}-${index}`}>
                <button
                  type="button"
                  onClick={() => reveal(item)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {item.severity === "error" ? (
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-error-foreground" aria-label="Error" />
                  ) : (
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" aria-label="Warning" />
                  )}
                  <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                    Ln {item.line}, Col {item.column}
                  </span>
                  <span className="min-w-0 flex-1">{item.message}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{item.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      <DeployStatus />

      <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <ProblemSummary checking={insight.checking} errors={errors} warnings={warnings} />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRevision((value) => value + 1);
              setProblemsOpen(true);
              if (errors + warnings === 0) toast.success("No problems found.");
              else toast.warning(`Found ${errors + warnings} ${errors + warnings === 1 ? "problem" : "problems"}.`);
            }}
          >
            <ScanSearch />
            Lint
          </Button>
          <DeployButton
            busy={busy === "deploy"}
            starting={!engineReady}
            disabled={busy !== null && busy !== "deploy"}
            buildConstructorKwargs={insight.constructor?.params.length ? constructorInput.build : () => "{}"}
          />
        </div>
      </footer>
    </Panel>
  );
}

/** The outcome of the last deploy, next to the button that started it. */
function DeployStatus() {
  const run = usePlayground((state) => (state.lastRun?.kind === "deploy" ? state.lastRun : null));
  if (!run) return null;
  const { outcome } = run;
  return (
    <div
      role={outcome.ok ? "status" : "alert"}
      data-testid="deploy-status"
      className={cn(
        "flex items-start gap-2 border-t px-4 py-2 text-xs",
        outcome.ok ? "bg-success-muted text-success-foreground" : "bg-error-muted text-error-foreground",
      )}
    >
      {outcome.ok ? <CircleCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 break-words">
        {outcome.ok ? `Deployed ${run.contract}.` : `Deploy of ${run.contract} failed: ${outcome.error ?? "unknown error"}`}
      </span>
      {run.metered && <span className="shrink-0 tabular-nums">{outcome.chiUsed.toLocaleString("en-US")} chi used</span>}
    </div>
  );
}

function EditorLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Loading editor…
    </div>
  );
}

function ProblemSummary({ checking, errors, warnings }: { checking: boolean; errors: number; warnings: number }) {
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

function Collapsible({ open, onToggle, label, children }: { open: boolean; onToggle(): void; label: string; children: React.ReactNode }) {
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

interface DeployButtonProps {
  busy: boolean;
  /** The VM is still loading. */
  starting: boolean;
  disabled: boolean;
  /** Constructor kwargs as wire JSON text, or null when the form has errors. */
  buildConstructorKwargs(): string | null;
}

function DeployButton({ busy, starting, disabled, buildConstructorKwargs }: DeployButtonProps) {
  const controller = useController();
  const deploy = useCallback(() => {
    const constructorKwargs = buildConstructorKwargs();
    if (constructorKwargs === null) {
      toast.error("Check the constructor arguments.");
      return;
    }
    void controller.deploy(constructorKwargs);
  }, [controller, buildConstructorKwargs]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const inEditor = (event.target as HTMLElement | null)?.closest?.("[data-testid='code-editor']");
      if (inEditor && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        deploy();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [deploy]);

  return (
    <Button size="sm" onClick={deploy} disabled={disabled || busy || starting} aria-keyshortcuts="Control+Enter Meta+Enter">
      {busy || starting ? <Loader2 className="animate-spin" /> : <Rocket />}
      {starting ? "Starting VM…" : busy ? "Deploying…" : "Deploy"}
      <Kbd aria-hidden className="ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">⌘↵</Kbd>
    </Button>
  );
}
