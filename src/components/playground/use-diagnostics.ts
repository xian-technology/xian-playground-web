"use client";

import { useEffect, useState } from "react";

import { extractMethods, type ContractMethod } from "@/lib/contract/methods";
import { compile, compilerErrorMessage, diagnose, type Diagnostic } from "@/lib/engine/compiler";

export interface CodeInsight {
  diagnostics: Diagnostic[];
  /** The `@construct` function when the code compiles. */
  constructor: ContractMethod | null;
  checking: boolean;
}

const DELAY_MS = 300;

/** Live compiler diagnostics (debounced) for the editor contents. */
export function useDiagnostics(contractName: string, code: string, revision: number): CodeInsight {
  const [insight, setInsight] = useState<CodeInsight>({ diagnostics: [], constructor: null, checking: true });

  useEffect(() => {
    const moduleName = /^[a-z][a-z0-9_]{0,63}$/.test(contractName) ? contractName : "con_playground";
    const timer = setTimeout(() => {
      let diagnostics: Diagnostic[];
      try {
        diagnostics = diagnose(moduleName, code);
      } catch (error) {
        diagnostics = [{ severity: "error", code: "compiler", message: compilerErrorMessage(error), line: 1, column: 1, endLine: 1, endColumn: 1 }];
      }
      let constructor: ContractMethod | null = null;
      if (!diagnostics.some((item) => item.severity === "error")) {
        try {
          constructor = extractMethods(compile(moduleName, code).vmIrJson).constructor;
        } catch (error) {
          diagnostics = [...diagnostics, { severity: "error", code: "compiler", message: compilerErrorMessage(error), line: 1, column: 1, endLine: 1, endColumn: 1 }];
        }
      }
      setInsight({ diagnostics, constructor, checking: false });
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [contractName, code, revision]);

  return insight;
}
