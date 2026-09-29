import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "@jest/globals";
import {
  findForbiddenEnvKeys,
  findWholeEnvReferences,
} from "@/config/envGuard";

const repoRoot = join(__dirname, "..", "..", "..");

describe("whole-object import.meta.env detection", () => {
  it("catches the construct that inlines the entire environment", () => {
    for (const source of [
      "const v3 = v3Deployment(import.meta.env);",
      "const all = { ...import.meta.env };",
      "const value = import.meta.env[key];",
      "console.log(import.meta.env);",
      "const e = import . meta . env ;",
    ]) {
      expect(findWholeEnvReferences(source)).not.toEqual([]);
    }
  });

  it("allows a literal key access, which Vite replaces with one value", () => {
    for (const source of [
      "const prod = import.meta.env.PROD;",
      'const url = import.meta.env["VITE_RPC_URL_PRODUCTION"];',
      "const base = import.meta.env.BASE_URL;",
      "const a = import.meta.env.DEV ? 1 : 2;",
    ]) {
      expect(findWholeEnvReferences(source)).toEqual([]);
    }
  });

  it("does not trip on prose describing the rule", () => {
    for (const source of [
      "// never hand import.meta.env to a function",
      "/* import.meta.env as a whole object is banned */",
      'throw new Error("import.meta.env must not be spread");',
      "const note = `import.meta.env is inlined wholesale`;",
    ]) {
      expect(findWholeEnvReferences(source)).toEqual([]);
    }
  });

  it("passes the config module that used to hold the offending call", () => {
    const networks = readFileSync(
      join(repoRoot, "src/config/networks.ts"),
      "utf8",
    );
    expect(findWholeEnvReferences(networks)).toEqual([]);
  });
});

describe("forbidden environment key detection", () => {
  it("catches a published seed however it was inlined", () => {
    // The shape the live qrlwallet.com bundle actually had: Vite's whole-env
    // object literal, with every VITE_ variable present at build time.
    const wholeEnvInline =
      "var p=d({BASE_URL:`/`,DEV:!1,MODE:`production`,PROD:!0," +
      "VITE_RPC_URL_PRODUCTION:`https://qrlwallet.com/api/qrl-rpc`," +
      "VITE_SEED:``,VITE_V3_CHAIN_ID:`0x301825`});";
    expect(findForbiddenEnvKeys(wholeEnvInline)).toEqual(["VITE_SEED"]);
  });

  it("matches on the name, so an empty value is still a failure", () => {
    expect(findForbiddenEnvKeys("VITE_SEED:``")).toEqual(["VITE_SEED"]);
  });

  it("covers the whole family of dangerous names", () => {
    expect(
      findForbiddenEnvKeys(
        "VITE_API_KEY VITE_MNEMONIC VITE_PRIVATE_KEY VITE_SECRET_SALT " +
          "VITE_DB_PASSWORD VITE_ACCESS_TOKEN VITE_WALLET_SEED",
      ),
    ).toEqual([
      "VITE_ACCESS_TOKEN",
      "VITE_API_KEY",
      "VITE_DB_PASSWORD",
      "VITE_MNEMONIC",
      "VITE_PRIVATE_KEY",
      "VITE_SECRET_SALT",
      "VITE_WALLET_SEED",
    ]);
  });

  it("leaves the wallet's real public configuration alone", () => {
    expect(
      findForbiddenEnvKeys(
        "VITE_RPC_URL_PRODUCTION VITE_SERVER_URL_PRODUCTION " +
          "VITE_EXPLORER_URL_PRODUCTION VITE_V3_CHAIN_ID VITE_V3_GENESIS_HASH " +
          "VITE_V3_RPC_URL VITE_V3_SERVER_URL VITE_V3_EXPLORER_URL " +
          "VITE_V3_FACTORY_ADDRESS VITE_V3_QNS_REGISTRY VITE_WALLET_PROFILE " +
          "VITE_CUSTOMERC20FACTORY_ADDRESS VITE_DEPLOYER VITE_NODE_ENV",
      ),
    ).toEqual([]);
  });
});
