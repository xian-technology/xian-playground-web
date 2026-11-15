// Temporary declaration of @xian-tech/vm (ENGINE_API.md v1) until the
// package builds and ships its own wasm-bindgen types.
declare module "@xian-tech/vm" {
  export class VmChain {
    constructor(optionsJson?: string);
    clone(): VmChain;
    exportState(): string;
    static importState(snapshot: string): VmChain;
    deploy(requestJson: string): string;
    call(requestJson: string): string;
    get(key: string): string | undefined;
    items(prefix: string, limit?: number): string;
    setValue(key: string, wireText?: string): void;
    removeContract(name: string): void;
    contracts(): string;
    contract(name: string): string | undefined;
    stateRoot(): string;
    free(): void;
  }
  export function runtimeInfo(): string;
  export function canonicalDecimal(text: string): string;
}
