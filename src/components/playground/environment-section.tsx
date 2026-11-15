"use client";

import { ChevronDown, RotateCcw, Settings2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DEFAULT_ENVIRONMENT, DEFAULT_METERING, type EnvironmentSettings } from "@/lib/workspace/model";
import { cn } from "@/lib/utils";

import { useController, usePlayground } from "./context";

type Field = keyof EnvironmentSettings | "chiLimit";

interface FieldInfo {
  key: Field;
  label: string;
  code: string;
  help: string;
  placeholder?: string;
}

const FIELDS: FieldInfo[] = [
  { key: "signer", label: "Signer", code: "ctx.signer", help: "The account that sends each transaction (also ctx.caller for direct calls). Use sys to deploy system contracts without the con_ prefix." },
  { key: "now", label: "Block time", code: "now", help: "Timestamp contracts see as now, in ISO 8601 (YYYY-MM-DDTHH:MM:SS). Leave empty for none." },
  { key: "blockNum", label: "Block height", code: "block_num", help: "Block number contracts see. A whole number." },
  { key: "blockHash", label: "Block hash", code: "block_hash", help: "Block hash contracts see." },
  { key: "chainId", label: "Chain ID", code: "chain_id", help: "Chain identifier contracts see." },
  { key: "inputHash", label: "Random seed", code: "input_hash", help: "Seed input for random.*. Leave empty and contracts cannot use randomness." },
  { key: "chiLimit", label: "Chi budget", code: "chi_budget", help: "Most chi one transaction may use. Leave empty for the VM ceiling (1,000,000).", placeholder: "VM ceiling" },
];

/** Signer, block environment and metering for every deploy and call. */
export function EnvironmentSection() {
  const controller = useController();
  const environment = usePlayground((state) => state.doc.environment);
  const metering = usePlayground((state) => state.doc.metering);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const contentId = useId();
  const meteringId = useId();
  const saved: Record<Field, string> = { ...environment, chiLimit: metering.chiLimit };
  const defaults: Record<Field, string> = { ...DEFAULT_ENVIRONMENT, chiLimit: DEFAULT_METERING.chiLimit };
  const value = (key: Field) => draft[key] ?? saved[key];
  const dirty = Object.entries(draft).some(([key, text]) => text !== saved[key as Field]);

  const apply = async (patch: Record<string, string>) => {
    const { chiLimit, ...env } = { ...saved, ...patch };
    const result = await controller.updateEnvironment(env, { chiLimit });
    setErrors(result);
    if (Object.keys(result).length === 0) {
      setDraft({});
      toast.success("Environment updated.");
    }
  };

  return (
    <section id="environment" aria-labelledby={`${contentId}-title`} className="scroll-mt-20 rounded-xl border bg-card shadow-xs">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Settings2 className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span id={`${contentId}-title`} className="block text-sm font-semibold">
            Execution environment
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            Signer <code className="font-mono">{environment.signer}</code> · block {environment.blockNum || "none"} ·{" "}
            {metering.enabled ? "metered" : "unmetered"}
          </span>
        </span>
        <ChevronDown className={cn("mt-1 size-4 text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden />
      </button>
      <div id={contentId} hidden={!open} className="border-t px-4 py-4">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void apply(draft);
          }}
        >
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            {FIELDS.map((field) => (
              <EnvironmentField
                key={field.key}
                field={field}
                value={value(field.key)}
                defaultValue={defaults[field.key]}
                error={errors[field.key]}
                disabled={field.key === "chiLimit" && !metering.enabled}
                onChange={(text) => setDraft((current) => ({ ...current, [field.key]: text }))}
                onReset={() => void apply({ ...draft, [field.key]: defaults[field.key] })}
              />
            ))}
            <div className="grid content-start gap-1.5">
              <span className="text-xs font-medium">Metering</span>
              <div className="flex h-8 items-center gap-2">
                <Switch
                  id={meteringId}
                  checked={metering.enabled}
                  onCheckedChange={async (checked) => {
                    await controller.updateEnvironment({}, { enabled: checked });
                    toast.success(checked ? "Metering on." : "Metering off. Long-running calls stop after 10 seconds.");
                  }}
                />
                <label htmlFor={meteringId} className="text-xs text-muted-foreground">
                  Count chi like the chain
                </label>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            <code className="font-mono">ctx.caller</code> is set by the VM during contract-to-contract calls and cannot be overridden here.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={!dirty} onClick={() => (setDraft({}), setErrors({}))}>
              Discard
            </Button>
            <Button type="submit" size="sm" disabled={!dirty}>
              Apply changes
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

interface EnvironmentFieldProps {
  field: FieldInfo;
  value: string;
  defaultValue: string;
  error?: string;
  disabled?: boolean;
  onChange(value: string): void;
  onReset(): void;
}

function EnvironmentField({ field, value, defaultValue, error, disabled, onChange, onReset }: EnvironmentFieldProps) {
  const id = useId();
  return (
    <div className="grid content-start gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-xs font-medium">
          {field.label}
        </label>
        <code className="font-mono text-[0.7rem] text-muted-foreground">{field.code}</code>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto"
              onClick={onReset}
              disabled={disabled || value === defaultValue}
              aria-label={`Reset ${field.label} to default`}
            >
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset to {defaultValue === "" ? "empty" : defaultValue}</TooltipContent>
        </Tooltip>
      </div>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-help`}
        className="h-8 font-mono text-[0.8rem]"
      />
      <p id={`${id}-help`} className={cn("text-xs", error ? "text-error-foreground" : "text-muted-foreground")}>
        {error ?? field.help}
      </p>
    </div>
  );
}
