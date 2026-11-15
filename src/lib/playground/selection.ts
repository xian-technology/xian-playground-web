/** Which contract and function the panels show, derived from saved preferences. */

import { isSystemContract } from "@/lib/contract/names";
import type { ContractMethod } from "@/lib/contract/methods";

import type { ContractView } from "./controller";

export interface Selection {
  visible: ContractView[];
  hiddenSystemCount: number;
  contract: ContractView | null;
  method: ContractMethod | null;
}

/** Keep a saved choice while it still exists, otherwise fall back to the first option. */
export function resolveSelection(
  contracts: ContractView[],
  showSystem: boolean,
  contractName: string,
  functionName: string,
): Selection {
  const visible = showSystem ? contracts : contracts.filter((contract) => !isSystemContract(contract.name));
  const contract = visible.find((item) => item.name === contractName) ?? visible[0] ?? null;
  const exports = contract?.methods.exports ?? [];
  return {
    visible,
    hiddenSystemCount: contracts.length - visible.length,
    contract,
    method: exports.find((method) => method.name === functionName) ?? exports[0] ?? null,
  };
}
