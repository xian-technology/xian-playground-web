"use client";

import { Ban, CircleAlert, CircleCheck, Terminal } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import type { RunRecord } from "@/lib/playground/controller";
import { describeWire, formatInline } from "@/lib/values/display";

import { SectionLabel } from "./panel";
import { WireValue } from "./wire-value";

/** The outcome of the last deploy or call: status, value or error, chi, writes and events. */
export function ResultView({ run }: { run: RunRecord | null }) {
  if (!run) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
        <Terminal className="size-4" aria-hidden />
        Run a function to see its result, chi used, state changes and events here.
      </div>
    );
  }
  return <RunDetails run={run} />;
}

function RunDetails({ run }: { run: RunRecord }) {
  const ref = useRef<HTMLDivElement>(null);
  // Bring each new result into view; the arguments above can push it below the fold.
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [run]);
  const { outcome } = run;
  const target = run.kind === "deploy" ? `deploy ${run.contract}` : `${run.contract}.${run.function}()`;
  return (
    <div ref={ref} className="grid scroll-mb-3 gap-3" aria-live="polite" data-testid="run-result">
      <div className="flex flex-wrap items-center gap-2">
        {outcome.ok ? (
          <Badge variant="success">
            <CircleCheck aria-hidden /> Success
          </Badge>
        ) : outcome.rejected ? (
          <Badge variant="warning">
            <Ban aria-hidden /> Refused
          </Badge>
        ) : (
          <Badge variant="error">
            <CircleAlert aria-hidden /> Failed
          </Badge>
        )}
        <code className="min-w-0 truncate font-mono text-xs">{target}</code>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {run.metered ? `${outcome.chiUsed.toLocaleString("en-US")} chi used` : "not metered"}
        </span>
      </div>

      {outcome.ok && run.kind === "call" && (
        <div className="grid gap-1">
          <SectionLabel>Return value</SectionLabel>
          <div className="rounded-md border bg-code px-3 py-2" data-testid="return-value">
            <WireValue text={outcome.result ?? "null"} />
          </div>
        </div>
      )}

      {!outcome.ok && (
        <div role="alert" className="rounded-md border border-error-foreground/30 bg-error-muted px-3 py-2 text-sm text-error-foreground" data-testid="run-error">
          {outcome.rejected ? "The VM refused this request: " : ""}
          {outcome.error}
        </div>
      )}

      {outcome.writes.length > 0 && (
        <div className="grid gap-1">
          <SectionLabel>State changes · {outcome.writes.length}</SectionLabel>
          <ul className="grid gap-1 rounded-md border bg-code px-3 py-2">
            {outcome.writes.map((write) => (
              <li key={write.key} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
                <code className="font-mono text-muted-foreground">{write.key}</code>
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
                {write.value === null ? <span className="italic text-muted-foreground">deleted</span> : <WireValue text={write.value} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {outcome.events.length > 0 && (
        <div className="grid gap-1">
          <SectionLabel>Events · {outcome.events.length}</SectionLabel>
          <ul className="grid gap-1.5 rounded-md border bg-code px-3 py-2">
            {outcome.events.map((event, index) => (
              <li key={`${event.event}-${index}`} className="grid gap-0.5 text-xs">
                <span>
                  <span className="font-medium">{event.event}</span>{" "}
                  <span className="text-muted-foreground">from {event.contract}</span>
                </span>
                <code className="font-mono break-all text-muted-foreground">
                  {formatInline(describeWire(event.dataIndexed))} {formatInline(describeWire(event.data))}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
