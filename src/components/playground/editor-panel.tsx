"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { FilePenLine, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { ContractMethod } from "@/lib/contract/methods";
import type { Diagnostic } from "@/lib/engine/compiler";

import { useController, usePlayground } from "./context";
import { Collapsible, DeployButton, DeployStatus, LintButton, NameField, ProblemsList, ProblemSummary } from "./editor-status";
import { KwargsForm } from "./kwargs-form";
import { monaco } from "./monaco-setup";
import { Panel } from "./panel";
import { useDiagnostics } from "./use-diagnostics";
import { useKwargs, type KwargsInput } from "./use-kwargs";

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

/** Show compiler diagnostics as Monaco markers (squiggles and hovers). */
function useCompilerMarkers(editorRef: RefObject<MonacoEditor | null>, diagnostics: Diagnostic[]): void {
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      "xian-compiler",
      diagnostics.map((item) => ({
        severity: SEVERITY[item.severity],
        message: `${item.message} (${item.code})`,
        startLineNumber: item.line,
        startColumn: item.column,
        endLineNumber: item.endLine,
        endColumn: Math.max(item.endColumn, item.column + 1),
      })),
    );
  }, [editorRef, diagnostics]);
}

export function EditorPanel() {
  const code = usePlayground((state) => state.doc.editor.code);
  const contractName = usePlayground((state) => state.doc.editor.contractName);
  const [revision, setRevision] = useState(0);
  const insight = useDiagnostics(contractName, code, revision);
  const editorRef = useRef<MonacoEditor | null>(null);
  const [problemsOpen, setProblemsOpen] = useState(true);
  const constructor = insight.constructor?.params.length ? insight.constructor : null;
  const constructorInput = useKwargs(constructor, constructor ? JSON.stringify(constructor.params) : "none");
  const onMount = useCallback((editor: MonacoEditor) => {
    editorRef.current = editor;
    setRevision((value) => value + 1);
  }, []);
  useCompilerMarkers(editorRef, insight.diagnostics);

  const reveal = useCallback((item: Diagnostic) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.revealLineInCenter(item.line);
    editor.setPosition({ lineNumber: item.line, column: item.column });
    editor.focus();
  }, []);

  return (
    <Panel id="write" icon={FilePenLine} title="Write contract" description="Write a contract, name it con_…, and deploy it to the in-browser chain.">
      <NameField />
      <CodeEditor onMount={onMount} />
      {constructor && <ConstructorSection constructor={constructor} input={constructorInput} />}
      {insight.diagnostics.length > 0 && (
        <Collapsible open={problemsOpen} onToggle={() => setProblemsOpen((open) => !open)} label={`Problems · ${insight.diagnostics.length}`}>
          <ProblemsList diagnostics={insight.diagnostics} onReveal={reveal} />
        </Collapsible>
      )}
      <DeployStatus />
      <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <ProblemSummary checking={insight.checking} diagnostics={insight.diagnostics} />
        <div className="ml-auto flex items-center gap-2">
          <LintButton
            diagnostics={insight.diagnostics}
            onLint={() => {
              setRevision((value) => value + 1);
              setProblemsOpen(true);
            }}
          />
          <DeployButton buildConstructorKwargs={constructor ? constructorInput.build : noConstructorKwargs} />
        </div>
      </footer>
    </Panel>
  );
}

const noConstructorKwargs = () => "{}";

function CodeEditor({ onMount }: { onMount(editor: MonacoEditor): void }) {
  const controller = useController();
  const code = usePlayground((state) => state.doc.editor.code);
  const { resolvedTheme } = useTheme();
  return (
    <div className="relative min-h-40 flex-1" data-testid="code-editor">
      <Editor
        value={code}
        language="python"
        theme={resolvedTheme === "dark" ? "playground-dark" : "playground-light"}
        options={EDITOR_OPTIONS}
        onChange={(value) => controller.setEditor({ code: value ?? "" })}
        onMount={onMount}
        loading={<EditorLoading />}
      />
    </div>
  );
}

function ConstructorSection({ constructor, input }: { constructor: ContractMethod; input: KwargsInput }) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onToggle={() => setOpen((current) => !current)} label={`Constructor arguments · ${constructor.name}()`}>
      <KwargsForm method={constructor} values={input.values} errors={input.errors} onChange={input.setValue} />
    </Collapsible>
  );
}

function EditorLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Loading editor…
    </div>
  );
}

