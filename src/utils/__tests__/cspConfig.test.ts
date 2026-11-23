import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const sourceHtml = readFileSync(resolve(root, "index.html"), "utf8");
const nginxConfig = readFileSync(resolve(root, "deploy/nginx.conf"), "utf8");
const nginxExample = readFileSync(
  resolve(root, "deploy/nginx.conf.example"),
  "utf8",
);

function inlineJsonLdHash(html: string): string {
  const match = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) throw new Error("index.html must contain JSON-LD");
  return `sha256-${createHash("sha256").update(match[1]).digest("base64")}`;
}

function metaCsp(html: string): string {
  const match = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?>/,
  );
  if (!match?.[1]) throw new Error("index.html must contain a meta CSP");
  return match[1];
}

describe("production content security policy", () => {
  it.each([nginxConfig, nginxExample])(
    "permits same-origin decorative playback while preserving other feature restrictions",
    (config) => {
      const policies = [
        ...config.matchAll(/add_header Permissions-Policy "([^"]+)" always;/g),
      ];
      expect(policies.length).toBeGreaterThan(0);
      for (const policy of policies) {
        expect(policy[1]).toBe(
          "accelerometer=(), autoplay=(self), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
        );
      }
      expect(config).not.toContain("autoplay=()");
    },
  );

  it("pins the only inline script and rejects script attributes", () => {
    const hash = inlineJsonLdHash(sourceHtml);
    const policy = metaCsp(sourceHtml);
    const scriptSrc = policy
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src "));

    expect(scriptSrc).toContain(`'${hash}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(policy).toContain("script-src-attr 'none'");
    for (const config of [nginxConfig, nginxExample]) {
      const policies = [
        ...config.matchAll(/Content-Security-Policy "([^"]+)"/g),
      ];
      expect(policies.length).toBeGreaterThan(0);
      for (const policy of policies) {
        expect(policy[1]).toContain(`'${hash}'`);
      }
    }
    expect(nginxConfig).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(nginxExample).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(nginxConfig).not.toContain("dev.qrlwallet.com");
  });

  it("denies embedding and dangerous plugin content in both policy layers", () => {
    const policy = metaCsp(sourceHtml);

    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(nginxConfig).toContain("frame-ancestors 'none'");
    expect(nginxConfig).toContain('X-Frame-Options "DENY"');
  });

  it("keeps the connect-src copies in step and the explorer hosts equal to the meta policy", () => {
    const connectSrc = (policy: string): string[] => {
      const directive = policy
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("connect-src "));
      return (directive ?? "").split(/\s+/).slice(1);
    };
    const explorerHosts = (sources: string[]): string[] =>
      sources
        .filter((source) =>
          /^https:\/\/(\w+\.)?(shorscan|zondscan)\.com$/.test(source),
        )
        .sort();
    const nginxPolicies = (config: string): string[] =>
      [...config.matchAll(/Content-Security-Policy "([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
    const metaHosts = explorerHosts(connectSrc(metaCsp(sourceHtml)));
    expect(metaHosts).toContain("https://shorscan.com");
    expect(metaHosts).toContain("https://zondscan.com");

    const expectedCopies: [string, number][] = [
      [nginxConfig, 2],
      [nginxExample, 3],
    ];
    for (const [config, count] of expectedCopies) {
      const policies = nginxPolicies(config);
      expect(policies).toHaveLength(count);
      const first = connectSrc(policies[0] ?? "");
      for (const policy of policies) {
        const sources = connectSrc(policy);
        expect(sources).toEqual(first);
        expect(explorerHosts(sources)).toEqual(metaHosts);
      }
    }
    expect(sourceHtml).toContain(
      '<link rel="preconnect" href="https://shorscan.com" />',
    );
  });
});
