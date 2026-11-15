"use client";

import { errorMessage } from "@/lib/errors";
import { useCallback, useState } from "react";

import { buildKwargs, parseField, type FieldValues, type KwargsResult } from "@/lib/contract/kwargs";
import type { ContractMethod } from "@/lib/contract/methods";
import { json, stringifyJson } from "@/lib/values/json";
import { sourceJsonToWire } from "@/lib/values/wire";

export type KwargsMode = "form" | "json";

export interface KwargsInput {
  mode: KwargsMode;
  values: FieldValues;
  errors: Record<string, string>;
  jsonText: string;
  jsonError: string | null;
  setMode(mode: KwargsMode): void;
  setValue(name: string, value: string): void;
  setJsonText(text: string): void;
  /** The kwargs as wire JSON object text, or null (errors are shown). */
  build(): string | null;
}

/**
 * Form or raw-JSON input for one method. The input starts over whenever
 * `resetKey` changes (another method, or a changed signature).
 */
export function useKwargs(method: ContractMethod | null, resetKey: string): KwargsInput {
  const [mode, setModeState] = useState<KwargsMode>("form");
  const [values, setValues] = useState<FieldValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [jsonText, setJsonTextState] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  useResetOnChange(resetKey, () => {
    setModeState("form");
    setValues({});
    setErrors({});
    setJsonTextState("{}");
    setJsonError(null);
  });

  const setValue = useCallback((name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, []);

  const setJsonText = useCallback((text: string) => {
    setJsonTextState(text);
    setJsonError(null);
  }, []);

  const setMode = useCallback(
    (next: KwargsMode) => {
      if (next === "json" && method) setJsonTextState(formToJson(method, values));
      setJsonError(null);
      setModeState(next);
    },
    [method, values],
  );

  const build = useCallback((): string | null => {
    if (!method) return null;
    const result = mode === "json" ? jsonKwargs(jsonText) : buildKwargs(method, values);
    if (result.ok) return stringifyJson(result.kwargs);
    if (mode === "json") setJsonError(result.errors.json ?? "");
    else setErrors(result.errors);
    return null;
  }, [method, mode, jsonText, values]);

  return { mode, values, errors, jsonText, jsonError, setMode, setValue, setJsonText, build };
}

/** Run `reset` while rendering when `key` changes (React's pattern for resetting state on a prop change). */
function useResetOnChange(key: string, reset: () => void): void {
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    reset();
  }
}

/** Raw JSON kwargs (exact numbers); the error is reported under the `json` key. */
export function jsonKwargs(text: string): KwargsResult {
  try {
    const node = sourceJsonToWire(text.trim() === "" ? "{}" : text);
    if (node.t !== "obj") throw new Error('Kwargs must be a JSON object, e.g. {"to": "bob"}.');
    return { ok: true, kwargs: node };
  } catch (error) {
    return { ok: false, errors: { json: errorMessage(error) } };
  }
}

/** Pre-fill the JSON editor from whatever the form already holds. */
function formToJson(method: ContractMethod, values: FieldValues): string {
  const entries = method.params.map((param): [string, ReturnType<typeof json.str>] => {
    const raw = values[param.name] ?? "";
    try {
      return [param.name, raw === "" && param.type !== "str" ? json.null() : parseField(param.type, raw)];
    } catch {
      return [param.name, json.str(raw)];
    }
  });
  return stringifyJson(json.obj(entries.filter(([, node]) => node.t !== "null")), 2);
}
