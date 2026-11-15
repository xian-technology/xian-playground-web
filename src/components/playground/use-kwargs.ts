"use client";

import { useCallback, useState } from "react";

import { buildKwargs, parseField, type FieldValues } from "@/lib/contract/kwargs";
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
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    // Adjusting state while rendering: React's pattern for resetting on a prop change.
    setKey(resetKey);
    setModeState("form");
    setValues({});
    setErrors({});
    setJsonTextState("{}");
    setJsonError(null);
  }

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
    if (mode === "json") {
      try {
        const node = sourceJsonToWire(jsonText.trim() === "" ? "{}" : jsonText);
        if (node.t !== "obj") throw new Error("Kwargs must be a JSON object, e.g. {\"to\": \"bob\"}.");
        return stringifyJson(node);
      } catch (error) {
        setJsonError(error instanceof Error ? error.message : String(error));
        return null;
      }
    }
    const result = buildKwargs(method, values);
    if (!result.ok) {
      setErrors(result.errors);
      return null;
    }
    return stringifyJson(result.kwargs);
  }, [method, mode, jsonText, values]);

  return { mode, values, errors, jsonText, jsonError, setMode, setValue, setJsonText, build };
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
