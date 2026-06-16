import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards the seed-script wiring so the documented Docker command keeps working
 * (the production image has no `tsx`).
 */
describe("seed script wiring", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const readme = readFileSync("README.md", "utf8");

  it("`seed` runs the compiled JS, `seed:dev` runs tsx", () => {
    expect(pkg.scripts.seed).toBe("node dist/scripts/seed.js");
    expect(pkg.scripts["seed:dev"]).toBe("tsx src/scripts/seed.ts");
  });

  it("README documents the working production Docker seed command", () => {
    expect(readme).toContain("docker compose exec gateway npm run seed");
  });

  it("README no longer uses the broken tsx-based Docker seed command", () => {
    expect(readme).not.toContain('node -e "require(\'./dist/scripts/seed.js\')"');
    expect(readme).not.toMatch(/docker compose .*tsx/);
  });
});
