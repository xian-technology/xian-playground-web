/**
 * The Rust contract compiler as WebAssembly (`@xian-tech/compiler`), used for
 * live diagnostics and for compiling deploy artifacts. Mirrors
 * xian-ide-web/src/lib/compiler.ts.
 */

import {
  compileContractArtifactJson,
  diagnoseContractJson,
} from "@xian-tech/compiler";

import type { ContractArtifact } from "./types";

export const VM_PROFILE = "xian_vm_v2";
const OPTIONS = JSON.stringify({ lint: true, vm_profile: VM_PROFILE });

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

export function diagnose(moduleName: string, source: string): Diagnostic[] {
  return parseDiagnostics(diagnoseContractJson(moduleName, source, OPTIONS));
}

/** Compile for deployment. Throws with the compiler's first diagnostic line. */
export function compile(moduleName: string, source: string): ContractArtifact {
  let raw: string;
  try {
    raw = compileContractArtifactJson(moduleName, source, OPTIONS);
  } catch (error) {
    throw new Error(compilerErrorMessage(error));
  }
  return parseArtifact(moduleName, raw);
}

export function parseDiagnostics(raw: string): Diagnostic[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("compiler returned non-array diagnostics");
  return parsed.map((item: RawDiagnostic) => {
    const range = item.range;
    const severity = item.severity === "warning" || item.severity === "info" ? item.severity : "error";
    return {
      severity,
      code: String(item.code),
      message: String(item.message),
      line: range?.start_line ?? 1,
      column: (range?.start_column ?? 0) + 1,
      endLine: range?.end_line ?? range?.start_line ?? 1,
      endColumn: (range?.end_column ?? range?.start_column ?? 0) + 1,
    };
  });
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
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split("\n", 1)[0]?.trim() || "The compiler failed.";
}
