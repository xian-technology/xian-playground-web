/**
 * The Rust contract compiler as WebAssembly (`@xian-tech/compiler`), used for
 * live diagnostics and for checking constructor signatures. Mirrors
 * xian-ide-web/src/lib/compiler.ts.
 */

import {
  compileContractArtifactJson,
  diagnoseContractJson,
} from "@xian-tech/compiler";

import { compilerErrorMessage, parseArtifact, parseDiagnostics, type Diagnostic } from "./compiler-output";
import type { ContractArtifact } from "./types";

export { compilerErrorMessage, parseArtifact, parseDiagnostics, type Diagnostic } from "./compiler-output";

export const VM_PROFILE = "xian_vm_v2";
const OPTIONS = JSON.stringify({ lint: true, vm_profile: VM_PROFILE });

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

