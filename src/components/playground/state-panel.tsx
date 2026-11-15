"use client";

import { Braces, Database, ListTree, Pencil, Save, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { StateEntry } from "@/lib/engine/types";
import { buildStateDocument, groupState, type StateGroup } from "@/lib/playground/state-doc";
import { stringifyJson } from "@/lib/values/json";

import { useController, usePlayground } from "./context";
import { Panel } from "./panel";
import { EmptyState } from "./shared";
import { WireValue } from "./wire-value";

type View = "tree" | "json";

/** Groups whose `contract.key` contains `filter` (case-insensitive). */
export function filterGroups(groups: StateGroup[], filter: string): StateGroup[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return groups;
  return groups
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => `${group.contract}.${entry.key}`.toLowerCase().includes(needle)) }))
    .filter((group) => group.entries.length > 0);
}

export function StatePanel() {
  const entries = usePlayground((state) => state.state);
  const showProtected = usePlayground((state) => state.ui.showProtectedKeys);
  const [view, setView] = useState<View>("tree");
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Panel id="state" icon={Database} title="Contract state" description="Every stored key, refreshed after each deploy and call.">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        {draft !== null ? (
          <p className="text-xs text-muted-foreground">
            Edit values as JSON. Removing a key deletes it; protected <code className="font-mono">__</code> keys are never changed.
          </p>
        ) : (
          <StateToolbar filter={filter} onFilter={setFilter} view={view} onView={setView} />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-testid="state-view">
        {draft !== null ? (
          <StateEditor draft={draft} onChange={setDraft} />
        ) : (
          <StateBody entries={entries} showProtected={showProtected} view={view} filter={filter} />
        )}
      </div>
      <StateFooter entries={entries} draft={draft} onDraft={setDraft} />
    </Panel>
  );
}

function StateToolbar({ filter, onFilter, view, onView }: { filter: string; onFilter(value: string): void; view: View; onView(view: View): void }) {
  const id = useId();
  return (
    <>
      <div className="relative min-w-40 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label htmlFor={id} className="sr-only">
          Filter keys
        </label>
        <Input
          id={id}
          value={filter}
          onChange={(event) => onFilter(event.target.value)}
          placeholder="Filter keys"
          className="h-8 pl-7 font-mono text-[0.8rem]"
          spellCheck={false}
        />
      </div>
      <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(value) => value && onView(value as View)} aria-label="State view">
        <ToggleGroupItem value="tree" className="px-2 text-xs" aria-label="Table">
          <ListTree className="size-3.5" aria-hidden /> Table
        </ToggleGroupItem>
        <ToggleGroupItem value="json" className="px-2 text-xs" aria-label="JSON">
          <Braces className="size-3.5" aria-hidden /> JSON
        </ToggleGroupItem>
      </ToggleGroup>
    </>
  );
}

function StateEditor({ draft, onChange }: { draft: string; onChange(value: string): void }) {
  const id = useId();
  return (
    <div className="flex h-full flex-col p-3">
      <label htmlFor={id} className="sr-only">
        State as JSON
      </label>
      <Textarea
        id={id}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="min-h-48 flex-1 resize-none font-mono text-[0.8rem]"
      />
    </div>
  );
}

function StateBody({ entries, showProtected, view, filter }: { entries: StateEntry[]; showProtected: boolean; view: View; filter: string }) {
  const groups = useMemo(() => groupState(entries, showProtected), [entries, showProtected]);
  if (groups.length === 0) {
    return <EmptyState icon={Database} title="No state yet" description="Deploy a contract or run a function; the keys it stores show up here." />;
  }
  if (view === "json") {
    return <pre className="p-4 font-mono text-[0.8rem] break-all whitespace-pre-wrap">{stringifyJson(buildStateDocument(entries, showProtected), 2)}</pre>;
  }
  const filtered = filterGroups(groups, filter);
  if (filtered.length === 0) return <p className="p-4 text-sm text-muted-foreground">No keys match “{filter}”.</p>;
  return <StateTable groups={filtered} />;
}

function StateTable({ groups }: { groups: StateGroup[] }) {
  return (
    <div className="divide-y">
      {groups.map((group) => (
        <section key={group.contract} aria-label={`${group.contract} state`}>
          <h3 className="sticky top-0 z-10 bg-card/95 px-4 py-1.5 font-mono text-xs font-semibold backdrop-blur">
            {group.contract}
            <span className="ml-2 font-sans font-normal text-muted-foreground">
              {group.entries.length} {group.entries.length === 1 ? "key" : "keys"}
            </span>
          </h3>
          <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1 px-4 pb-2 text-xs">
            {group.entries.map((entry) => (
              <div key={entry.key} className="contents">
                <dt className="truncate font-mono text-muted-foreground" title={entry.key}>
                  {entry.key || "(contract)"}
                </dt>
                <dd className="min-w-0">
                  <WireValue text={entry.value} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function StateFooter({ entries, draft, onDraft }: { entries: StateEntry[]; draft: string | null; onDraft(value: string | null): void }) {
  const controller = useController();
  const showProtected = usePlayground((state) => state.ui.showProtectedKeys);
  const busy = usePlayground((state) => state.busy);
  const id = useId();
  const save = async (text: string) => {
    if (await controller.editState(text)) onDraft(null);
  };
  return (
    <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Switch id={id} checked={showProtected} disabled={draft !== null} onCheckedChange={(checked) => controller.setUi({ showProtectedKeys: checked })} />
        <label htmlFor={id} className="text-xs text-muted-foreground">
          Show protected keys
        </label>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {draft !== null ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => onDraft(null)}>
              <X />
              Cancel
            </Button>
            <Button size="sm" disabled={busy !== null} onClick={() => void save(draft)}>
              <Save />
              Save changes
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => onDraft(stringifyJson(buildStateDocument(entries, false), 2))}>
            <Pencil />
            Edit state
          </Button>
        )}
      </div>
    </footer>
  );
}
