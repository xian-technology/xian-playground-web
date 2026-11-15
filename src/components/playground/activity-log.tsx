"use client";

import { ChevronDown, History, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LogLevel } from "@/lib/workspace/log";
import { cn } from "@/lib/utils";

import { useController, usePlayground } from "./context";

const LEVEL: Record<LogLevel, { label: string; variant: "info" | "success" | "warning" | "error" }> = {
  info: { label: "Info", variant: "info" },
  success: { label: "Success", variant: "success" },
  warning: { label: "Warning", variant: "warning" },
  error: { label: "Error", variant: "error" },
};

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function ActivityLog() {
  const controller = useController();
  const entries = usePlayground((state) => state.log);
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border bg-card shadow-xs">
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={id}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-4 py-3 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <History className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span id={`${id}-title`} className="block text-sm font-semibold">
              Activity log
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {entries.length === 0 ? "Deploys, calls and state changes appear here." : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}, newest first`}
            </span>
          </span>
          <ChevronDown className={cn("mt-1 size-4 text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden />
        </button>
        {open && entries.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => controller.clearLog()}>
            <Trash2 />
            Clear log
          </Button>
        )}
      </div>
      <div id={id} hidden={!open} className="border-t">
        {entries.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">Nothing yet. Deploy a contract to get started.</p>
        ) : (
          <ol className="max-h-96 divide-y overflow-auto" aria-label="Activity log entries">
            {entries.map((entry) => (
              <li key={entry.id} className="grid gap-1.5 px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={LEVEL[entry.level].variant}>{LEVEL[entry.level].label}</Badge>
                  <time dateTime={entry.at} className="text-xs text-muted-foreground tabular-nums">
                    {time.format(new Date(entry.at))}
                  </time>
                  <span className="font-mono text-xs text-muted-foreground">{entry.action}</span>
                </div>
                <p className="text-sm">{entry.message}</p>
                {entry.detail && (
                  <pre className="rounded-md border bg-code px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all text-muted-foreground">
                    {entry.detail}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
