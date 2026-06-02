import { describe, expect, test } from "vitest";
import {
  DEFAULT_BUDGET,
  detect,
  formatReport,
  type PluginProfile,
  type Violation,
} from "./plugin-budget-guardian";

// ─── Fixtures ─────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<PluginProfile> = {}): PluginProfile {
  return {
    timestamp: "2026-06-02T00:00:00.000Z",
    configPath: "/project/vite.config.ts",
    configSizeBytes: 2 * 1024,
    plugins: [
      { name: "react", source: "vite.config" },
      { name: "svgrPlugin", source: "vite.config" },
    ],
    distTotalBytes: 3 * 1024 * 1024,
    chunks: [
      {
        path: "/dist/assets/index-abc.js",
        relativePath: "assets/index-abc.js",
        sizeBytes: 200 * 1024,
        extension: ".js",
      },
      {
        path: "/dist/assets/index-xyz.css",
        relativePath: "assets/index-xyz.css",
        sizeBytes: 30 * 1024,
        extension: ".css",
      },
    ],
    cssFileCount: 1,
    ...overrides,
  };
}

// ─── Detect ───────────────────────────────────────────────────────────

describe("detect", () => {
  test("returns no violations when within budget", () => {
    const prof = makeProfile();
    const violations = detect(prof, DEFAULT_BUDGET);
    expect(violations.length).toBe(0);
  });

  test("detects config oversize", () => {
    const prof = makeProfile({ configSizeBytes: 15 * 1024 });
    const violations = detect(prof, DEFAULT_BUDGET);
    expect(violations.some((v) => v.kind === "config-oversize")).toBe(true);
  });

  test("detects plugin count overrun", () => {
    const plugins = Array.from({ length: 25 }, (_, i) => ({
      name: `plugin${i}`,
      source: "vite.config",
    }));
    const prof = makeProfile({ plugins });
    const violations = detect(prof, DEFAULT_BUDGET);
    expect(violations.some((v) => v.kind === "plugin-count")).toBe(true);
  });

  test("detects dist total overrun", () => {
    const prof = makeProfile({ distTotalBytes: 10 * 1024 * 1024 });
    const violations = detect(prof, DEFAULT_BUDGET);
    expect(violations.some((v) => v.kind === "dist-total")).toBe(true);
  });

  test("detects oversize chunk", () => {
    const prof = makeProfile({
      chunks: [
        {
          path: "/dist/assets/huge-abc.js",
          relativePath: "assets/huge-abc.js",
          sizeBytes: 300 * 1024,
          extension: ".js",
        },
      ],
    });
    const violations = detect(prof, DEFAULT_BUDGET);
    const chunkV = violations.find((v) => v.kind === "chunk-oversize");
    expect(chunkV).toBeDefined();
    expect(chunkV!.subject).toContain("huge-abc.js");
  });

  test("detects CSS file count overrun", () => {
    const prof = makeProfile({ cssFileCount: 15 });
    const violations = detect(prof, DEFAULT_BUDGET);
    expect(violations.some((v) => v.kind === "css-count")).toBe(true);
  });
});

// ─── Report ───────────────────────────────────────────────────────────

describe("formatReport", () => {
  test("shows success with no violations", () => {
    const prof = makeProfile();
    const report = formatReport(prof, [], "/project");
    expect(report).toContain("Vite Plugin Budget Guardian Report");
    expect(report).toContain("✅");
    expect(report).toContain("react");
  });

  test("lists violations in report", () => {
    const prof = makeProfile();
    const violations: Violation[] = [
      {
        kind: "chunk-oversize",
        subject: "assets/big.js",
        value: 500 * 1024,
        limit: 250 * 1024,
        message: "Chunk assets/big.js is 500KB (limit 250KB)",
      },
    ];
    const report = formatReport(prof, violations, "/project");
    expect(report).toContain("⚠️");
    expect(report).toContain("big.js");
  });
});
