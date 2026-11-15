"use client";

import { Maximize2, Minimize2, type LucideIcon } from "lucide-react";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PanelId = "write" | "inspect" | "execute" | "state";

interface MaximizeState {
  maximized: PanelId | null;
  toggle(id: PanelId): void;
}

export const MaximizeContext = createContext<MaximizeState>({ maximized: null, toggle: () => {} });

interface PanelProps {
  id: PanelId;
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The playground's panel: a titled card with optional actions and a
 * maximize button. A maximized panel covers the window (Esc restores it)
 * and the rest of the page becomes inert.
 */
export function Panel({ id, icon: Icon, title, description, actions, children, className }: PanelProps) {
  const { maximized, toggle } = useContext(MaximizeContext);
  const isMaximized = maximized === id;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isMaximized) return;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) toggle(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, isMaximized, toggle]);

  return (
    <section
      ref={ref}
      id={`panel-${id}`}
      aria-labelledby={`panel-${id}-title`}
      tabIndex={isMaximized ? -1 : undefined}
      inert={maximized !== null && !isMaximized}
      role={isMaximized ? "dialog" : undefined}
      aria-modal={isMaximized || undefined}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs outline-none",
        isMaximized ? "fixed inset-2 z-50 shadow-2xl sm:inset-4" : "h-full",
        className,
      )}
    >
      <header className="flex items-start gap-3 border-b px-4 py-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Icon className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={`panel-${id}-title`} className="text-sm leading-tight font-semibold">
            {title}
          </h2>
          <p className="truncate text-xs text-muted-foreground" title={description}>
            {description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => toggle(id)}
            aria-label={isMaximized ? `Restore ${title} panel` : `Maximize ${title} panel`}
            title={isMaximized ? "Restore (Esc)" : "Maximize"}
            aria-pressed={isMaximized}
          >
            {isMaximized ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** A small uppercase section label inside a panel. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase", className)}>{children}</h3>;
}
