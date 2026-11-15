"use client";

import Editor from "@monaco-editor/react";
import { FileCode2, FileSearch, PencilLine, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { resolveSelection } from "@/lib/playground/selection";
import { prettyWire } from "@/lib/values/display";

import { useController, usePlayground } from "./context";
import { Panel } from "./panel";
import { Confirm, ContractPicker, EmptyState, SystemContractsSwitch } from "./shared";

const VIEWER_OPTIONS = {
  readOnly: true,
  domReadOnly: true,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: "on" as const,
  fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
  fontSize: 12.5,
  padding: { top: 10, bottom: 10 },
  renderLineHighlight: "none" as const,
};

export function InspectPanel() {
  const controller = useController();
  const contracts = usePlayground((state) => state.contracts);
  const ui = usePlayground((state) => state.ui);
  const busy = usePlayground((state) => state.busy);
  const { resolvedTheme } = useTheme();
  const selection = resolveSelection(contracts, ui.showSystemContracts, ui.inspectContract, "");
  const contract = selection.contract;
  const showIr = ui.inspectView === "ir";

  return (
    <Panel id="inspect" icon={FileSearch} title="Inspect contract" description="Read the source and VM IR of a deployed contract.">
      <div className="flex flex-wrap items-end gap-3 border-b px-4 py-2.5">
        <ContractPicker
          label="Contract"
          contracts={selection.visible}
          value={contract?.name ?? ""}
          onChange={(name) => controller.setUi({ inspectContract: name })}
        />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={ui.inspectView}
          onValueChange={(value) => value && controller.setUi({ inspectView: value as "source" | "ir" })}
          aria-label="View"
        >
          <ToggleGroupItem value="source" className="px-2.5 text-xs">
            Source
          </ToggleGroupItem>
          <ToggleGroupItem value="ir" className="px-2.5 text-xs">
            VM IR
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {contract ? (
        <div className="relative min-h-40 flex-1" aria-label={`${contract.name} ${showIr ? "VM IR" : "source"}`}>
          <Editor
            key={`${contract.name}-${ui.inspectView}`}
            value={showIr ? prettyWire(contract.vmIrJson) : contract.source}
            language={showIr ? "json" : "python"}
            theme={resolvedTheme === "dark" ? "playground-dark" : "playground-light"}
            options={{ ...VIEWER_OPTIONS, ariaLabel: `${contract.name} ${showIr ? "VM IR" : "source"} (read-only)` }}
          />
        </div>
      ) : (
        <EmptyState
          icon={FileCode2}
          title="No contracts to inspect"
          description={
            selection.hiddenSystemCount > 0
              ? "Deploy a contract to see it here, or show system contracts to look at the built-in ones."
              : "Deploy a contract to see its source and VM IR here."
          }
        />
      )}
      <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <SystemContractsSwitch hiddenCount={selection.hiddenSystemCount} />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!contract}
            onClick={() => {
              if (!contract) return;
              controller.setCode(contract.source);
              controller.setContractName(contract.name);
              toast.info(`Opened ${contract.name} in the editor.`);
            }}
          >
            <PencilLine />
            Open in editor
          </Button>
          <Confirm
            title={`Remove ${contract?.name ?? "contract"}?`}
            description="This deletes the contract and all of its state from your local chain. You can deploy it again later."
            confirmLabel="Remove contract"
            onConfirm={() => contract && void controller.removeContract(contract.name)}
            trigger={
              <Button variant="destructive" size="sm" disabled={!contract || contract.name === "submission" || busy !== null}>
                <Trash2 />
                Remove
              </Button>
            }
          />
        </div>
      </footer>
    </Panel>
  );
}
