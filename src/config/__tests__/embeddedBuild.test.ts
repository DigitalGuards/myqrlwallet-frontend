import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "@jest/globals";
import {
  EMBEDDED_RELAY_URLS,
  buildEmbeddedCsp,
  findEmbeddedHtmlViolations,
  inlineWorkerSpecifier,
  toHttpOrigin,
  toSecureWebSocketOrigin,
} from "@/config/embeddedBuild";

const repoRoot = join(__dirname, "..", "..", "..");

describe("worker specifier rewrite", () => {
  it("makes a ?worker import inline so no worker URL is fetched", () => {
    expect(inlineWorkerSpecifier("./cryptoWorker?worker")).toBe(
      "./cryptoWorker?worker&inline",
    );
  });

  it("leaves every other specifier alone", () => {
    for (const source of [
      "./cryptoWorker",
      "react",
      "./cryptoWorker?worker&inline",
      "./sprite.svg?url",
      "@/utils/crypto/cryptoWorker.ts",
    ]) {
      expect(inlineWorkerSpecifier(source)).toBeNull();
    }
  });

  it("rewrites the specifier the crypto worker client actually uses", () => {
    const client = readFileSync(
      join(repoRoot, "src/utils/crypto/cryptoWorkerClient.ts"),
      "utf8",
    );
    const match = client.match(/from\s+["']([^"']*\?worker)["']/);
    expect(match).not.toBeNull();
    expect(inlineWorkerSpecifier(match?.[1] ?? "")).toContain("?worker&inline");
  });
});

describe("origin helpers", () => {
  it("reduces a URL to its origin", () => {
    expect(toHttpOrigin("https://qrlwallet.com/api/qrl-rpc")).toBe(
      "https://qrlwallet.com",
    );
    expect(toHttpOrigin("https://relay.example.com:8443/relay")).toBe(
      "https://relay.example.com:8443",
    );
  });

  it("rejects anything that is not an absolute http(s) URL", () => {
    for (const value of ["", "/api", "ws://x.example", "data:,", undefined]) {
      expect(toHttpOrigin(value)).toBeNull();
    }
  });

  it("derives the wss origin only from an https one", () => {
    expect(toSecureWebSocketOrigin("https://qrlwallet.com/api")).toBe(
      "wss://qrlwallet.com",
    );
    expect(toSecureWebSocketOrigin("http://localhost:3000")).toBeNull();
  });
});

describe("embedded CSP", () => {
  const csp = buildEmbeddedCsp({
    connectUrls: [
      "https://qrlwallet.com/api/qrl-rpc",
      "https://qrlwallet.com/api",
      "https://zondscan.com",
    ],
    relayUrls: EMBEDDED_RELAY_URLS,
  });

  it("allows no remote script source and no eval", () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval';");
    expect(csp).not.toMatch(/script-src[^;]*https:/);
  });

  it("covers every endpoint the wallet calls, once each", () => {
    const connectSrc = csp
      .split("; ")
      .find((directive) => directive.startsWith("connect-src "));
    expect(connectSrc).toBeDefined();
    const origins = (connectSrc ?? "").split(" ").slice(1);
    expect(origins).toEqual([
      "https://qrlwallet.com",
      "https://zondscan.com",
      "wss://qrlwallet.com",
    ]);
  });

  it("keeps the worker, font and media sources local to the document", () => {
    expect(csp).toContain("worker-src blob:");
    expect(csp).toContain("font-src data:");
    expect(csp).toContain("media-src data: blob:");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it("refuses to emit a policy that would block all traffic", () => {
    expect(() =>
      buildEmbeddedCsp({ connectUrls: ["/api"], relayUrls: [] }),
    ).toThrow(/empty connect-src/);
  });

  it("follows the configured deployment", () => {
    const v3 = buildEmbeddedCsp({
      connectUrls: ["https://rpc-v3.example.com/rpc/testnet"],
      relayUrls: ["https://relay.example.com"],
    });
    expect(v3).toContain(
      "connect-src https://relay.example.com https://rpc-v3.example.com wss://relay.example.com",
    );
  });
});

describe("relay allowlist", () => {
  it("matches the relay the dApp-connect service defaults to", () => {
    const service = readFileSync(
      join(repoRoot, "src/services/dappConnect/DAppConnectService.ts"),
      "utf8",
    );
    const match = service.match(/DEFAULT_RELAY_URL\s*=\s*["']([^"']+)["']/);
    expect(match).not.toBeNull();
    expect(EMBEDDED_RELAY_URLS).toContain(match?.[1]);
  });
});

describe("self-contained document scan", () => {
  const clean = [
    "<!doctype html><html><head>",
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'" />',
    '<link rel="me" href="https://x.com/DigitalGuards" />',
    "<script>window.__QRL_EMBEDDED__=true</script>",
    '<script type="module" id="qrl-embedded-app">const a=1;</script>',
    "<style>body{color:red}</style>",
    "</head><body><div id=\"root\"></div></body></html>",
  ].join("");

  it("passes a fully inlined document", () => {
    expect(findEmbeddedHtmlViolations(clean)).toEqual([]);
  });

  it("ignores tag-like text inside the inlined script and style", () => {
    const withNoisyScript = clean.replace(
      "const a=1;",
      'const a="<link rel=\\"stylesheet\\" href=\\"/assets/x.css\\">";',
    );
    expect(findEmbeddedHtmlViolations(withNoisyScript)).toEqual([]);
  });

  it("catches a remote script", () => {
    const violations = findEmbeddedHtmlViolations(
      clean.replace(
        '<script type="module" id="qrl-embedded-app">',
        '<script type="module" src="/assets/index.js">',
      ),
    );
    expect(violations.join("\n")).toContain("src attribute");
  });

  it("catches a stylesheet link, a preload and a favicon", () => {
    for (const tag of [
      '<link rel="stylesheet" href="https://cdn.example.com/a.css" />',
      '<link rel="preload" href="/tree.svg" as="image" />',
      '<link rel="icon" href="/favicon.ico" />',
      '<link rel="manifest" href="/manifest.webmanifest" />',
    ]) {
      expect(
        findEmbeddedHtmlViolations(clean.replace("</head>", `${tag}</head>`)),
      ).not.toEqual([]);
    }
  });

  it("catches a document-relative asset reference", () => {
    const violations = findEmbeddedHtmlViolations(
      clean.replace('<div id="root"></div>', '<img src="/tree.svg" />'),
    );
    expect(violations.join("\n")).toContain("document-relative URL");
  });

  it("catches a leftover /assets/ reference in markup", () => {
    const violations = findEmbeddedHtmlViolations(
      clean.replace("</body>", "<!-- /assets/index.js --></body>"),
    );
    expect(violations).toContain("markup references /assets/");
  });
});
