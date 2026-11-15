/**
 * Reading the compiler's JSON output: diagnostics and deploy artifacts.
 * Kept apart from the WebAssembly bindings so it can be used and tested
 * without loading the compiler.
 */

import { errorMessage } from "@/lib/errors";
import type { ContractArtifact } from "./types";

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  /** 1-based line and column of the start and end. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

interface RawDiagnostic {
  severity: string;
  code: string;
  message: string;
  range?: { start_line: number; start_column: number; end_line: number; end_column: number } | null;
}

export function parseDiagnostics(raw: string): Diagnostic[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("compiler returned non-array diagnostics");
  return parsed.map(toDiagnostic);
}

const SEVERITIES: Diagnostic["severity"][] = ["error", "warning", "info"];

function toDiagnostic(item: RawDiagnostic): Diagnostic {
  const severity = SEVERITIES.find((value) => value === item.severity) ?? "error";
  return { severity, code: String(item.code), message: String(item.message), ...toPosition(item.range) };
}

/** 1-based positions; a diagnostic without a range points at the first line. */
function toPosition(range: RawDiagnostic["range"]): Pick<Diagnostic, "line" | "column" | "endLine" | "endColumn"> {
  if (!range) return { line: 1, column: 1, endLine: 1, endColumn: 1 };
  return {
    line: range.start_line,
    column: range.start_column + 1,
    endLine: range.end_line,
    endColumn: range.end_column + 1,
  };
}

export function parseArtifact(moduleName: string, raw: string): ContractArtifact {
  const artifact = JSON.parse(raw) as Record<string, unknown>;
  if (artifact.format !== "xian_contract_artifact_v1" || artifact.module_name !== moduleName) {
    throw new Error("compiler returned an unexpected artifact");
  }
  if (typeof artifact.source !== "string" || typeof artifact.vm_ir_json !== "string") {
    throw new Error("compiler artifact is missing source or VM IR");
  }
  return { source: artifact.source, vmIrJson: artifact.vm_ir_json };
}

export function compilerErrorMessage(error: unknown): string {
  const raw = errorMessage(error);
  return raw.split("\n", 1)[0]?.trim() || "The compiler failed.";
}
