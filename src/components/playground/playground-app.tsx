"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { createBrowserEngine } from "@/lib/engine/create-engine";
import { errorMessage } from "@/lib/errors";
import { PlaygroundController } from "@/lib/playground/controller";
import type { WorkspaceDoc } from "@/lib/workspace/model";
import { createWorkspaceStore } from "@/lib/workspace/persistence";
import { decodeShareFragment, SHARE_PREFIX } from "@/lib/workspace/share";

import { ActivityLog } from "./activity-log";
import { AppHeader } from "./app-header";
import { ControllerContext, useController, usePlayground } from "./context";
import { EditorPanel } from "./editor-panel";
import { EnvironmentSection } from "./environment-section";
import { ExecutePanel } from "./execute-panel";
import { InspectPanel } from "./inspect-panel";
import { MaximizeContext, type PanelId } from "./panel";
import { StatePanel } from "./state-panel";

interface PendingDoc {
  doc: WorkspaceDoc;
  origin: "share link" | "file";
}

export function PlaygroundApp() {
  const controller = useMemo(
    () =>
      new PlaygroundController({
        engine: createBrowserEngine(),
        store: createWorkspaceStore(),
        notify: (level, message) => toast[level](message),
      }),
    [],
  );
  const [pending, setPending] = useState<PendingDoc | null>(null);

  useEffect(() => {
    void controller.init().then(async () => {
      const doc = await takeShareLinkFromUrl();
      if (doc) setPending({ doc, origin: "share link" });
    });
  }, [controller]);
  useSaveShortcut(controller);

  return (
    <ControllerContext.Provider value={controller}>
      <Shell onOpenDoc={(doc, origin) => setPending({ doc, origin })} />
      <OpenDocDialog
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void controller.importDoc(pending.doc, pending.origin);
          setPending(null);
        }}
      />
    </ControllerContext.Provider>
  );
}

/** The workspace in the URL's share fragment (removed from the URL), if any. */
async function takeShareLinkFromUrl(): Promise<WorkspaceDoc | null> {
  const hash = window.location.hash;
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    return await decodeShareFragment(hash);
  } catch (error) {
    toast.error(errorMessage(error));
    return null;
  }
}

/** Cmd/Ctrl+S saves now (edits also save on their own). */
function useSaveShortcut(controller: PlaygroundController): void {
  useEffect(() => {
    const onKey = async (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (await controller.saveNow()) toast.success("Saved in this browser.");
      else toast.warning("This browser blocks storage, so nothing could be saved.");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller]);
}

function Shell({ onOpenDoc }: { onOpenDoc(doc: WorkspaceDoc, origin: "file"): void }) {
  const phase = usePlayground((state) => state.phase);
  const [maximized, setMaximized] = useState<PanelId | null>(null);
  const toggle = useCallback((id: PanelId) => setMaximized((current) => (current === id ? null : id)), []);
  const maximize = useMemo(() => ({ maximized, toggle }), [maximized, toggle]);

  if (phase === "loading") return <LoadingScreen />;
  if (phase === "failed") return <FailedScreen />;

  return (
    <MaximizeContext.Provider value={maximize}>
      <div className="flex min-h-dvh flex-col">
        <div inert={maximized !== null}>
          <AppHeader onOpenDoc={onOpenDoc} />
          <EngineNotice />
          <StorageNotice />
        </div>
        <main className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 py-4">
          <Workbench />
          <div inert={maximized !== null} className="grid grid-cols-[minmax(0,1fr)] gap-4">
            <EnvironmentSection />
            <ActivityLog />
          </div>
        </main>
      </div>
      {maximized && <div className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm" aria-hidden />}
    </MaximizeContext.Provider>
  );
}

const DESKTOP_QUERY = "(min-width: 1024px)";

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(DESKTOP_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

/** The four panels: a resizable 2x2 grid on desktop, a stack on small screens. */
function Workbench() {
  const desktop = useIsDesktop();
  if (!desktop) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <div className="h-[34rem]">
          <EditorPanel />
        </div>
        <div className="h-[28rem]">
          <InspectPanel />
        </div>
        <div className="h-[36rem]">
          <ExecutePanel />
        </div>
        <div className="h-[28rem]">
          <StatePanel />
        </div>
      </div>
    );
  }
  return (
    <div className="h-[calc(100dvh-5.5rem)] min-h-[40rem]">
      <ResizablePanelGroup orientation="vertical" id="playground-rows">
        <ResizablePanel defaultSize="52%" minSize="25%">
          <ResizablePanelGroup orientation="horizontal" id="playground-top">
            <ResizablePanel defaultSize="55%" minSize="30%" className="pr-2 pb-2">
              <EditorPanel />
            </ResizablePanel>
            <ResizableHandle withHandle aria-label="Resize editor and inspector" />
            <ResizablePanel defaultSize="45%" minSize="25%" className="pb-2 pl-2">
              <InspectPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="Resize top and bottom rows" />
        <ResizablePanel defaultSize="48%" minSize="25%">
          <ResizablePanelGroup orientation="horizontal" id="playground-bottom">
            <ResizablePanel defaultSize="55%" minSize="30%" className="pt-2 pr-2">
              <ExecutePanel />
            </ResizablePanel>
            <ResizableHandle withHandle aria-label="Resize execute and state panels" />
            <ResizablePanel defaultSize="45%" minSize="25%" className="pt-2 pl-2">
              <StatePanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function StorageNotice() {
  const available = usePlayground((state) => state.storageAvailable);
  if (available) return null;
  return (
    <div role="status" className="border-b bg-warning-muted px-4 py-2 text-center text-xs text-warning-foreground">
      This browser blocks site storage, so your workspace is kept only until you close this tab. Use Export to keep a copy.
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center" role="status">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
      <p className="text-sm font-medium">Opening your workspace…</p>
    </div>
  );
}

/** Shown while the VM's WebAssembly (about 1.8 MB compressed) downloads and starts. */
function EngineNotice() {
  const starting = usePlayground((state) => state.engine === "starting");
  if (!starting) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b bg-info-muted px-4 py-1.5 text-xs text-info-foreground">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      Starting the Xian VM in your browser. You can edit while it loads.
    </div>
  );
}

function FailedScreen() {
  const error = usePlayground((state) => state.loadError);
  const controller = useController();
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div role="alert" className="grid max-w-md gap-3 rounded-xl border bg-card p-6 shadow-xs">
        <div className="flex items-center gap-2 text-error-foreground">
          <AlertTriangle className="size-5" aria-hidden />
          <h1 className="text-base font-semibold">The playground could not start</h1>
        </div>
        <p className="text-sm text-muted-foreground">Your saved workspace could not be loaded. Starting fresh clears it from this browser.</p>
        {error && <pre className="rounded-md bg-code p-3 font-mono text-xs whitespace-pre-wrap break-all">{error}</pre>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
          <Button onClick={() => void controller.startFresh()}>Start fresh</Button>
        </div>
      </div>
    </div>
  );
}

function OpenDocDialog({ pending, onCancel, onConfirm }: { pending: PendingDoc | null; onCancel(): void; onConfirm(): void }) {
  const names = pending?.doc.contracts.map((contract) => contract.name) ?? [];
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open this {pending?.origin ?? "workspace"}?</AlertDialogTitle>
          <AlertDialogDescription>
            It replaces your current workspace. Its contracts are compiled and deployed again from their source
            {names.length > 0 ? `: ${names.join(", ")}.` : "."} Export first if you want to keep what you have.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my workspace</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Open {pending?.origin ?? "workspace"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
