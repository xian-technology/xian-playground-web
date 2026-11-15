import { describe, expect, it } from "vitest";

import { DEFAULT_CONTRACT, DEFAULT_CONTRACT_NAME, defaultWorkspace, parseWorkspaceDoc, MAX_SOURCE_BYTES } from "@/lib/workspace/model";

const valid = () => ({
  format: "xian-playground-workspace",
  version: 1,
  editor: { code: "x = 1", contractName: "con_x" },
  environment: { signer: "alice", now: "2024-02-01T12:30:00", blockNum: "100", blockHash: "0xabc", chainId: "playground-local" },
  metering: { enabled: false, chiLimit: "200000" },
  contracts: [
    { name: "con_x", source: "v = Variable()", constructorKwargs: "{}", state: [["v", '{"__fixed__":"1.5"}']] },
  ],
});

describe("defaultWorkspace", () => {
  it("starts with the demo token contract like the old playground", () => {
    const ws = defaultWorkspace();
    expect(ws.editor).toEqual({ code: DEFAULT_CONTRACT, contractName: DEFAULT_CONTRACT_NAME });
    expect(ws.environment.signer).toBe("demo");
    expect(ws.environment.now).toBe("2024-02-01T12:30:00");
    expect(ws.environment.blockNum).toBe("100");
    expect(ws.metering.enabled).toBe(false);
    expect(ws.contracts).toEqual([]);
  });
});

describe("parseWorkspaceDoc (untrusted input from links and files)", () => {
  it("accepts a well-formed document", () => {
    expect(parseWorkspaceDoc(valid())).toEqual(valid());
  });

  it("rejects wrong formats and versions", () => {
    expect(() => parseWorkspaceDoc({ ...valid(), format: "other" })).toThrow(/not a playground workspace/);
    expect(() => parseWorkspaceDoc({ ...valid(), version: 2 })).toThrow(/version/);
    expect(() => parseWorkspaceDoc(null)).toThrow();
    expect(() => parseWorkspaceDoc([])).toThrow();
  });

  it("rejects invalid contract names, duplicates and oversized sources", () => {
    const bad = (contract: object) => () => parseWorkspaceDoc({ ...valid(), contracts: [contract] });
    expect(bad({ ...valid().contracts[0], name: "Bad" })).toThrow(/contract name/);
    expect(bad({ ...valid().contracts[0], name: "submission" })).toThrow(/contract name/);
    expect(bad({ ...valid().contracts[0], source: "x".repeat(MAX_SOURCE_BYTES + 1) })).toThrow(/too large/);
    expect(() => parseWorkspaceDoc({ ...valid(), contracts: [valid().contracts[0], valid().contracts[0]] })).toThrow(/twice/);
  });

  it("rejects state values that are not exact wire JSON", () => {
    const withState = (state: unknown) => () =>
      parseWorkspaceDoc({ ...valid(), contracts: [{ ...valid().contracts[0], state }] });
    expect(withState([["v", "1.5"]])).toThrow(/bare decimal/);
    expect(withState([["v", "{"]])).toThrow(/JSON/);
    expect(withState([["__code__", '"x"']])).toThrow(/protected key/);
    expect(withState([[5, "1"]])).toThrow();
  });

  it("rejects wrong field types and unknown environment values", () => {
    expect(() => parseWorkspaceDoc({ ...valid(), editor: { code: 5, contractName: "con_x" } })).toThrow(/editor.code/);
    expect(() => parseWorkspaceDoc({ ...valid(), environment: { ...valid().environment, blockNum: 7 } })).toThrow(/environment.blockNum/);
    expect(() => parseWorkspaceDoc({ ...valid(), metering: { enabled: "yes", chiLimit: "1" } })).toThrow(/metering.enabled/);
  });

  it("drops unknown top-level fields instead of carrying them along", () => {
    const parsed = parseWorkspaceDoc({ ...valid(), extra: "x" });
    expect("extra" in parsed).toBe(false);
  });
});
