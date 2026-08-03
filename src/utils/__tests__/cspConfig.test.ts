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
    expect(nginxConfig).toContain(`'${hash}'`);
    expect(nginxExample).toContain(`'${hash}'`);
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
});
