"use client";

import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fieldValue, type FieldValues } from "@/lib/contract/kwargs";
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
          value={fieldValue(values, param.name) ?? ""}
          error={fieldValue(errors, param.name)}
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
  const hintId = param.defaultText !== null ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const control: ControlProps = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
    "aria-required": param.required || undefined,
  };
  return (
    <div className="grid gap-1.5">
      <ParamLabel param={param} htmlFor={id} />
      <ParamInput param={param} value={value} control={control} onChange={onChange} onSubmit={onSubmit} />
      {hintId && (
        <p id={hintId} className="text-xs text-muted-foreground">
          Leave empty to use the default: <code className="font-mono">{param.defaultText}</code>
        </p>
      )}
      {errorId && (
        <p id={errorId} role="alert" className="text-xs text-error-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

interface ControlProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  "aria-required": true | undefined;
}

function ParamLabel({ param, htmlFor }: { param: MethodParam; htmlFor: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={htmlFor} className="font-mono text-[0.8rem] font-medium">
        {param.name}
      </label>
      <Badge variant="type">{param.annotation ?? "Any"}</Badge>
      {!param.required && <span className="text-xs text-muted-foreground">optional</span>}
      {param.keywordOnly && <span className="text-xs text-muted-foreground">keyword-only</span>}
    </div>
  );
}

interface ParamInputProps {
  param: MethodParam;
  value: string;
  control: ControlProps;
  onChange(value: string): void;
  onSubmit?(): void;
}

/** Cmd/Ctrl+Enter submits from any field; plain Enter also submits single-line fields. */
function submitKeys(onSubmit: (() => void) | undefined, singleLine: boolean) {
  return (event: React.KeyboardEvent) => {
    const modEnter = (event.metaKey || event.ctrlKey) && event.key === "Enter";
    if (!modEnter && !(singleLine && event.key === "Enter")) return;
    event.preventDefault();
    onSubmit?.();
  };
}

function ParamInput({ param, value, control, onChange, onSubmit }: ParamInputProps) {
  if (param.type === "bool") return <BoolInput required={param.required} value={value} control={control} onChange={onChange} />;
  const shared = {
    ...control,
    value,
    spellCheck: false,
    placeholder: PLACEHOLDERS[param.type],
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  };
  if (MULTILINE.includes(param.type)) {
    return <Textarea {...shared} onKeyDown={submitKeys(onSubmit, false)} className="min-h-16 font-mono text-[0.8rem]" />;
  }
  const numeric = NUMERIC.includes(param.type);
  return (
    <Input
      {...shared}
      autoComplete="off"
      inputMode={numeric ? "decimal" : undefined}
      onKeyDown={submitKeys(onSubmit, true)}
      className={cn("font-mono text-[0.8rem]", numeric && "tabular-nums")}
    />
  );
}

function BoolInput({ required, value, control, onChange }: { required: boolean; value: string; control: ControlProps; onChange(value: string): void }) {
  const selected = value !== "" ? value : required ? undefined : DEFAULT_CHOICE;
  return (
    <Select value={selected} onValueChange={(choice) => onChange(choice === DEFAULT_CHOICE ? "" : choice)}>
      <SelectTrigger {...control} className="w-full sm:w-48">
        <SelectValue placeholder="Choose true or false" />
      </SelectTrigger>
      <SelectContent>
        {!required && <SelectItem value={DEFAULT_CHOICE}>Use default</SelectItem>}
        <SelectItem value="true">true</SelectItem>
        <SelectItem value="false">false</SelectItem>
      </SelectContent>
    </Select>
  );
}
