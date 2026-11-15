"use client";

import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FieldValues } from "@/lib/contract/kwargs";
import type { ContractMethod, MethodParam, ParamType } from "@/lib/contract/methods";
import { cn } from "@/lib/utils";

const PLACEHOLDERS: Record<ParamType, string> = {
  int: "e.g. 25",
  decimal: "e.g. 1.5",
  str: "text",
  bool: "",
  dict: '{"key": "value"}',
  list: "[1, 2, 3]",
  datetime: "YYYY-MM-DDTHH:MM:SS",
  timedelta: "seconds, e.g. 3600",
  bytes: "hex, e.g. 00ff",
  bytearray: "hex, e.g. 00ff",
  set: '{"__set__": {"codec": "xian-set-1", "items": [...]}}',
  frozenset: '{"__frozenset__": {"codec": "xian-set-1", "items": [...]}}',
  any: 'JSON, e.g. "text" or 5',
};

const MULTILINE: ParamType[] = ["dict", "list", "set", "frozenset", "any"];
const NUMERIC: ParamType[] = ["int", "decimal", "timedelta"];
const DEFAULT_CHOICE = "__default__";

interface KwargsFormProps {
  method: ContractMethod;
  values: FieldValues;
  errors: Record<string, string>;
  onChange(name: string, value: string): void;
  onSubmit?(): void;
}

/** Typed inputs for every parameter of a contract method. */
export function KwargsForm({ method, values, errors, onChange, onSubmit }: KwargsFormProps) {
  if (method.params.length === 0) {
    return <p className="text-sm text-muted-foreground">This function takes no arguments.</p>;
  }
  return (
    <div className="grid gap-3">
      {method.params.map((param) => (
        <ParamField
          key={param.name}
          param={param}
          value={values[param.name] ?? ""}
          error={errors[param.name]}
          onChange={(value) => onChange(param.name, value)}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}

interface ParamFieldProps {
  param: MethodParam;
  value: string;
  error?: string;
  onChange(value: string): void;
  onSubmit?(): void;
}

function ParamField({ param, value, error, onChange, onSubmit }: ParamFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [param.defaultText !== null ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": param.required || undefined,
  };
  const submitOnModEnter = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="font-mono text-[0.8rem] font-medium">
          {param.name}
        </label>
        <Badge variant="type">{param.annotation ?? "Any"}</Badge>
        {!param.required && <span className="text-xs text-muted-foreground">optional</span>}
        {param.keywordOnly && <span className="text-xs text-muted-foreground">keyword-only</span>}
      </div>
      {param.type === "bool" ? (
        <Select
          value={value === "" ? (param.required ? undefined : DEFAULT_CHOICE) : value}
          onValueChange={(choice) => onChange(choice === DEFAULT_CHOICE ? "" : choice)}
        >
          <SelectTrigger {...common} className="w-full sm:w-48">
            <SelectValue placeholder="Choose true or false" />
          </SelectTrigger>
          <SelectContent>
            {!param.required && <SelectItem value={DEFAULT_CHOICE}>Use default</SelectItem>}
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      ) : MULTILINE.includes(param.type) ? (
        <Textarea
          {...common}
          value={value}
          spellCheck={false}
          placeholder={PLACEHOLDERS[param.type]}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={submitOnModEnter}
          className="min-h-16 font-mono text-[0.8rem]"
        />
      ) : (
        <Input
          {...common}
          value={value}
          spellCheck={false}
          autoComplete="off"
          inputMode={NUMERIC.includes(param.type) ? "decimal" : undefined}
          placeholder={PLACEHOLDERS[param.type]}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            submitOnModEnter(event);
            if (event.key === "Enter" && !event.defaultPrevented) onSubmit?.();
          }}
          className={cn("font-mono text-[0.8rem]", NUMERIC.includes(param.type) && "tabular-nums")}
        />
      )}
      {param.defaultText !== null && (
        <p id={hintId} className="text-xs text-muted-foreground">
          Leave empty to use the default: <code className="font-mono">{param.defaultText}</code>
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-error-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
