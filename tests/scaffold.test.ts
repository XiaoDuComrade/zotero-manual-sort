import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Zotero package metadata", () => {
  it("targets Zotero 9 maintenance releases", () => {
    const manifest = JSON.parse(readFileSync("addon/manifest.json", "utf8"));
    expect(manifest.applications.zotero.strict_min_version).toBe("9.0");
    expect(manifest.applications.zotero.strict_max_version).toBe("9.0.*");
    expect(manifest.icons).toEqual({
      "48": "content/icons/mouse-click.svg",
      "96": "content/icons/mouse-click.svg",
    });
    expect(readFileSync("addon/content/icons/mouse-click.svg", "utf8")).toContain(
      'viewBox="0 0 1024 1024"',
    );
  });

  it("uses a versioned XPI filename", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const config = readFileSync("zotero-plugin.config.ts", "utf8");
    expect(config).toContain("zotero-manual-sort-${pkg.version}");
    expect(`zotero-manual-sort-${pkg.version}.xpi`).toMatch(
      /^zotero-manual-sort-\d+\.\d+\.\d+\.xpi$/,
    );
  });

  it("guards Cu.unload for Zotero shutdown", () => {
    expect(readFileSync("addon/bootstrap.js", "utf8")).toContain(
      'typeof Cu.unload === "function"',
    );
  });
});
