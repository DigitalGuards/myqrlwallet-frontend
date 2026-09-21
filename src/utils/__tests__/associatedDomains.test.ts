import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const associationPath = "/.well-known/apple-app-site-association";

describe("iOS universal links", () => {
  it("associates only the native app's exact connect route", () => {
    const source = readFileSync(
      resolve(root, `public${associationPath}`),
      "utf8",
    );
    expect(JSON.parse(source)).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["6255H2F3DX.com.chiefdg.myqrlwallet"],
            components: [{ "/": "/connect" }],
          },
        ],
      },
    });
    expect(Buffer.byteLength(source, "utf8")).toBeLessThan(128 * 1024);
  });

  it.each(["deploy/nginx.conf", "deploy/nginx.conf.example"])(
    "%s serves both exact association routes as JSON with inherited headers",
    (file) => {
      const config = readFileSync(resolve(root, file), "utf8");
      for (const [route, target] of [
        [associationPath, "$uri"],
        ["/apple-app-site-association", associationPath],
      ] as const) {
        const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = config.match(
          new RegExp(`location = ${escaped} \\{([^}]+)\\}`),
        );
        expect(match).not.toBeNull();
        const body = match?.[1] ?? "";
        expect(body).toContain("default_type application/json;");
        expect(body).toContain(`try_files ${target} =404;`);
        expect(body).not.toMatch(/add_header|rewrite|return|index\.html/);
      }
      expect(config).toContain('add_header X-Content-Type-Options "nosniff"');
      expect(config).toContain("add_header Strict-Transport-Security");
    },
  );
});
