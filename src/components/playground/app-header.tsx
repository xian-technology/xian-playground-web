"use client";

import {
  BookOpen,
  Download,
  FolderOpen,
  Keyboard,
  Laptop,
  Link2,
  Moon,
  MoreHorizontal,
  RotateCcw,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRef, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { parseWorkspaceDoc, type WorkspaceDoc } from "@/lib/workspace/model";
import { encodeShareFragment } from "@/lib/workspace/share";

import { useController } from "./context";
import { EXAMPLES } from "./examples";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

interface AppHeaderProps {
  onOpenDoc(doc: WorkspaceDoc, origin: "file"): void;
}

export function AppHeader({ onOpenDoc }: AppHeaderProps) {
  const controller = useController();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const share = async () => {
    try {
      const fragment = await encodeShareFragment(controller.exportDoc());
      const url = `${window.location.origin}${window.location.pathname}${fragment}`;
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied.", { description: "Anyone with the link gets a copy of this workspace." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create a share link.");
    }
  };

  const exportFile = () => {
    const text = JSON.stringify(controller.exportDoc(), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `xian-playground-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    if (file.size > IMPORT_MAX_BYTES) {
      toast.error("This file is larger than 10 MB.");
      return;
    }
    try {
      onOpenDoc(parseWorkspaceDoc(JSON.parse(await file.text())), "file");
    } catch (error) {
      toast.error(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const loadExample = (id: string) => {
    const example = EXAMPLES.find((item) => item.id === id);
    if (!example) return;
    const previous = controller.getState().doc.editor;
    controller.setCode(example.code);
    controller.setContractName(example.contractName);
    toast.success(`Loaded the ${example.title} example.`, {
      action: {
        label: "Undo",
        onClick: () => {
          controller.setCode(previous.code);
          controller.setContractName(previous.contractName);
        },
      },
    });
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/favicon.png" alt="" className="size-7 rounded-md" />
        <div className="min-w-0">
          <h1 className="truncate text-base leading-tight font-semibold tracking-tight">
            Xian <span className="text-brand-gradient"><span className="hidden sm:inline">Contracting </span>Playground</span>
          </h1>
          <p className="hidden truncate text-xs text-muted-foreground md:block">
            Deploy and call smart contracts without leaving the browser. Nothing leaves your machine.
          </p>
        </div>

        <nav className="ml-auto flex items-center gap-1" aria-label="Workspace">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
                <BookOpen />
                Examples
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Load into the editor</DropdownMenuLabel>
              {EXAMPLES.map((example) => (
                <DropdownMenuItem key={example.id} onSelect={() => loadExample(example.id)} className="flex-col items-start gap-0">
                  <span className="font-medium">{example.title}</span>
                  <span className="text-xs text-muted-foreground">{example.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" onClick={() => void share()}>
            <Link2 />
            <span className="hidden sm:inline">Share</span>
            <span className="sr-only sm:hidden">Copy share link</span>
          </Button>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="More workspace actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Workspace</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem className="sm:hidden" onSelect={() => loadExample("counter")}>
                <BookOpen /> Load an example
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={exportFile}>
                <Download /> Export workspace
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                <FolderOpen /> Import workspace…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmReset(true)}>
                <RotateCcw /> Reset workspace…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ShortcutsHelp />
          <ThemeMenu />
        </nav>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every deployed contract and all state, and puts the demo contract back in the editor. Export first if you want to keep
              anything.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void controller.resetWorkspace()}>
              Reset workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Theme">
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Laptop /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘/Ctrl + ↵", "Deploy (in the editor) or run (in the call form)"],
  ["⌘/Ctrl + S", "Save now (edits also save automatically)"],
  ["Esc", "Restore a maximized panel"],
];

function ShortcutsHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" className="hidden sm:inline-flex">
          <Keyboard />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <h2 className="mb-2 text-sm font-semibold">Keyboard shortcuts</h2>
        <dl className="grid gap-2 text-xs">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="flex items-center justify-between gap-3">
              <dt>
                <Kbd>{keys}</Kbd>
              </dt>
              <dd className="text-right text-muted-foreground">{action}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
