import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string): string =>
  readFileSync(resolve(root, path), "utf8");

const networks = read("src/config/networks.ts");
const dockerfile = read("deploy/Dockerfile");
const workflow = read(".github/workflows/ci.yml");
const envExample = read(".env.example");
const readme = read("README.md");

describe("production deployment configuration", () => {
  it("builds with the same production variable contract the application reads", () => {
    expect(networks).toContain("import.meta.env.PROD");
    expect(networks).not.toContain("VITE_NODE_ENV");

    for (const variable of [
      "VITE_RPC_URL_PRODUCTION",
      "VITE_SERVER_URL_PRODUCTION",
      "VITE_EXPLORER_URL_PRODUCTION",
    ]) {
      expect(networks).toContain(variable);
      expect(dockerfile).toContain(variable);
      expect(workflow).toContain(variable);
      expect(readme).toContain(variable);
    }

    expect(dockerfile).not.toContain("VITE_RPC_URL_TESTNET");
    expect(dockerfile).not.toContain("VITE_RPC_URL_MAINNET");
    expect(workflow).not.toContain("VITE_RPC_URL_TESTNET");
    expect(workflow).not.toContain("VITE_RPC_URL_MAINNET");
    expect(dockerfile.match(/@sha256:[0-9a-f]{64}/g)).toHaveLength(2);
  });

  it("never suggests exposing seed material through Vite client variables", () => {
    expect(envExample).not.toContain("VITE_SEED");
    expect(readme).not.toContain("VITE_SEED");
    expect(readme).toContain(
      "Never place seeds, mnemonics, private keys, or credentials",
    );
  });
});
