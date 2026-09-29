import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "@jest/globals";
import {
  EMBEDDED_RELAY_URLS,
  buildEmbeddedCsp,
  findEmbeddedCspViolations,
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
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'wasm-unsafe-eval\'; connect-src https://qrlwallet.com" />',
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

  it("catches an unquoted relative attribute", () => {
    const violations = findEmbeddedHtmlViolations(
      clean.replace('<div id="root"></div>', "<img src=/tree.svg>"),
    );
    expect(violations.join("\n")).toContain("document-relative URL");
  });

  it("catches a link written without the self-closing slash", () => {
    const violations = findEmbeddedHtmlViolations(
      clean.replace("</head>", '<link rel="icon" href="/favicon.ico"></head>'),
    );
    expect(violations.join("\n")).toContain("fetching <link>");
  });

  it("catches a stylesheet that fetches a file", () => {
    const violations = findEmbeddedHtmlViolations(
      clean.replace("body{color:red}", "body{background:url(/tree.svg)}"),
    );
    expect(violations).toContain("the stylesheet fetches /tree.svg");
  });

  it("catches @import in the stylesheet", () => {
    const violations = findEmbeddedHtmlViolations(
      clean.replace("body{color:red}", '@import "https://fonts.example/x.css";'),
    );
    expect(violations).toContain("the stylesheet uses @import");
  });

  it("allows a url() reference nested inside a data: SVG", () => {
    // The repo's noise texture is a percent-encoded SVG whose own markup
    // contains filter='url(%23n)'. A scan that stopped at that inner bracket
    // would report the fragment as a remote fetch and fail every build.
    const nested =
      "body{background-image:url(\"data:image/svg+xml,%3Csvg%3E%3Crect filter='url(%23n)'/%3E%3C/svg%3E\")}";
    expect(
      findEmbeddedHtmlViolations(clean.replace("body{color:red}", nested)),
    ).toEqual([]);
  });
});

describe("CSP enforcement", () => {
  const withCsp = (content: string) =>
    [
      "<html><head>",
      `<meta http-equiv="Content-Security-Policy" content="${content}" />`,
      "</head><body></body></html>",
    ].join("");

  const embedded =
    "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; connect-src https://qrlwallet.com";

  it("accepts the locked-down embedded policy", () => {
    expect(findEmbeddedCspViolations(withCsp(embedded))).toEqual([]);
  });

  it("rejects the development policy index.html ships", () => {
    // The failure this guard exists for: the CSP rewrite silently not matching
    // leaves this policy in place, and under the WebView baseUrl 'self' IS
    // qrlwallet.com, so the web server could serve script again.
    const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");
    const devCsp = indexHtml.match(
      /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]*)"/,
    );
    expect(devCsp).not.toBeNull();
    const violations = findEmbeddedCspViolations(withCsp(devCsp?.[1] ?? ""));
    expect(violations).toContain("the CSP still allows 'self'");
    expect(violations).toContain("the CSP does not start from default-src 'none'");
  });

  it("rejects unsafe-eval, a remote script source and a missing policy", () => {
    expect(
      findEmbeddedCspViolations(withCsp(`${embedded}; script-src 'unsafe-eval'`)),
    ).toContain("the CSP still allows 'unsafe-eval'");
    expect(
      findEmbeddedCspViolations(
        withCsp("default-src 'none'; script-src 'unsafe-inline' https://cdn.example"),
      ).join("\n"),
    ).toContain("remote script source");
    expect(findEmbeddedCspViolations("<html><head></head></html>")).toEqual([
      "expected exactly one CSP meta, found 0",
    ]);
  });

  it("is reached through the document scan", () => {
    const violations = findEmbeddedHtmlViolations(
      "<html><head></head><body></body></html>",
    );
    expect(violations).toContain("expected exactly one CSP meta, found 0");
  });
});
