/**
 * Plugin Budget Guardian for Vite
 *
 * Budget → Profile → Detect → Report
 *
 * Measures Vite plugin pipeline contributions: how much each plugin adds to
 * build time, bundle size, and dev server overhead. Detects plugins that
 * bloat beyond conservation budgets.
 *
 * Run: `npx tsx guardian/plugin-budget-guardian.ts`
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, extname, relative } from "node:path";

// ─── Budget ───────────────────────────────────────────────────────────

export interface PluginBudget {
  /** Max total config file (vite.config.*) size in KB */
  maxConfigKb: number;
  /** Max number of plugins before warning */
  maxPluginCount: number;
  /** Max total build output (dist/) in MB */
  maxDistMb: number;
  /** Max single chunk in KB */
  maxChunkKb: number;
  /** Max number of CSS files output */
  maxCssFiles: number;
}

export const DEFAULT_BUDGET: PluginBudget = {
  maxConfigKb: 10,
  maxPluginCount: 20,
  maxDistMb: 5,
  maxChunkKb: 250,
  maxCssFiles: 10,
};

// ─── Profile ──────────────────────────────────────────────────────────

export interface PluginEntry {
  name: string;
  source: string; // where we found it
}

export interface ChunkInfo {
  path: string;
  relativePath: string;
  sizeBytes: number;
  extension: string;
}

export interface PluginProfile {
  timestamp: string;
  configPath: string | null;
  configSizeBytes: number;
  plugins: PluginEntry[];
  distTotalBytes: number;
  chunks: ChunkInfo[];
  cssFileCount: number;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function extractPluginNames(configContent: string): PluginEntry[] {
  const plugins: PluginEntry[] = [];

  // Match `plugins: [...]` arrays
  const pluginsBlock = configContent.match(/plugins\s*:\s*\[([\s\S]*?)\]/);
  if (!pluginsBlock) return plugins;

  const block = pluginsBlock[1];

  // Match various plugin patterns:
  // - named imports: react(), vue(), tailwindcss()
  // - bare names: vitePluginFoo
  // - arrays spread: ...someArray
  const patterns = [
    /(\w+)\(\)/g,            // function call plugins like react()
    /(\w+Plugin)/g,          // named plugins
    /vite-plugin-(\w+)/g,    // vite-plugin-xxx references
  ];

  const seen = new Set<string>();
  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(block)) !== null) {
      const name = match[1];
      if (!seen.has(name)) {
        seen.add(name);
        plugins.push({ name, source: "vite.config" });
      }
    }
  }

  return plugins;
}

export async function profileProject(
  projectRoot: string,
): Promise<PluginProfile> {
  let configPath: string | null = null;
  let configSizeBytes = 0;
  let configContent = "";
  const plugins: PluginEntry[] = [];

  // Find vite config
  for (const candidate of [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mts",
    "vite.config.mjs",
  ]) {
    try {
      const fullPath = join(projectRoot, candidate);
      const s = await stat(fullPath);
      configPath = fullPath;
      configSizeBytes = s.size;
      configContent = await readFile(fullPath, "utf-8");
      break;
    } catch {
      continue;
    }
  }

  // Extract plugin names from config
  if (configContent) {
    plugins.push(...extractPluginNames(configContent));
  }

  // Profile dist output
  const distPath = join(projectRoot, "dist");
  const chunks: ChunkInfo[] = [];
  let distTotalBytes = 0;
  let cssFileCount = 0;

  try {
    for await (const filePath of walk(distPath)) {
      const s = await stat(filePath);
      const ext = extname(filePath);
      const rel = relative(distPath, filePath);

      chunks.push({
        path: filePath,
        relativePath: rel,
        sizeBytes: s.size,
        extension: ext,
      });

      distTotalBytes += s.size;
      if (ext === ".css") cssFileCount++;
    }
  } catch {
    // no dist
  }

  chunks.sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    timestamp: new Date().toISOString(),
    configPath,
    configSizeBytes,
    plugins,
    distTotalBytes,
    chunks,
    cssFileCount,
  };
}

// ─── Detect ───────────────────────────────────────────────────────────

export interface Violation {
  kind: "config-oversize" | "plugin-count" | "dist-total" | "chunk-oversize" | "css-count";
  subject: string;
  value: number;
  limit: number;
  message: string;
}

export function detect(
  profile: PluginProfile,
  budget: PluginBudget = DEFAULT_BUDGET,
): Violation[] {
  const violations: Violation[] = [];

  // Config size
  if (profile.configSizeBytes > budget.maxConfigKb * 1024) {
    violations.push({
      kind: "config-oversize",
      subject: profile.configPath || "vite.config",
      value: profile.configSizeBytes,
      limit: budget.maxConfigKb * 1024,
      message: `Config is ${(profile.configSizeBytes / 1024).toFixed(1)}KB (limit ${budget.maxConfigKb}KB)`,
    });
  }

  // Plugin count
  if (profile.plugins.length > budget.maxPluginCount) {
    violations.push({
      kind: "plugin-count",
      subject: "plugins",
      value: profile.plugins.length,
      limit: budget.maxPluginCount,
      message: `${profile.plugins.length} plugins detected (limit ${budget.maxPluginCount})`,
    });
  }

  // Dist total
  if (profile.distTotalBytes > budget.maxDistMb * 1024 * 1024) {
    violations.push({
      kind: "dist-total",
      subject: "dist/",
      value: profile.distTotalBytes,
      limit: budget.maxDistMb * 1024 * 1024,
      message: `Build output ${(profile.distTotalBytes / 1024 / 1024).toFixed(1)}MB (limit ${budget.maxDistMb}MB)`,
    });
  }

  // Individual chunks
  for (const chunk of profile.chunks) {
    if (chunk.extension === ".js" && chunk.sizeBytes > budget.maxChunkKb * 1024) {
      violations.push({
        kind: "chunk-oversize",
        subject: chunk.relativePath,
        value: chunk.sizeBytes,
        limit: budget.maxChunkKb * 1024,
        message: `Chunk ${chunk.relativePath} is ${(chunk.sizeBytes / 1024).toFixed(0)}KB (limit ${budget.maxChunkKb}KB)`,
      });
    }
  }

  // CSS file count
  if (profile.cssFileCount > budget.maxCssFiles) {
    violations.push({
      kind: "css-count",
      subject: "css files",
      value: profile.cssFileCount,
      limit: budget.maxCssFiles,
      message: `${profile.cssFileCount} CSS files (limit ${budget.maxCssFiles})`,
    });
  }

  return violations;
}

// ─── Report ───────────────────────────────────────────────────────────

export function formatReport(
  profile: PluginProfile,
  violations: Violation[],
  projectRoot: string,
): string {
  const lines: string[] = [];
  const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(2)} MB`;

  lines.push("═══════════════════════════════════════════════");
  lines.push("  ⚡ Vite Plugin Budget Guardian Report");
  lines.push("═══════════════════════════════════════════════");
  lines.push(`  Timestamp : ${profile.timestamp}`);
  lines.push(`  Project   : ${projectRoot}`);
  lines.push("");

  lines.push("  ── Config ──");
  lines.push(`  File      : ${profile.configPath || "(not found)"}`);
  lines.push(`  Size      : ${kb(profile.configSizeBytes)}`);
  lines.push(`  Plugins   : ${profile.plugins.length}`);
  if (profile.plugins.length > 0) {
    for (const p of profile.plugins.slice(0, 15)) {
      lines.push(`    • ${p.name}`);
    }
    if (profile.plugins.length > 15) {
      lines.push(`    ... and ${profile.plugins.length - 15} more`);
    }
  }
  lines.push("");

  lines.push("  ── Build Output ──");
  lines.push(`  Total     : ${mb(profile.distTotalBytes)}`);
  lines.push(`  Chunks    : ${profile.chunks.length}`);
  lines.push(`  CSS files : ${profile.cssFileCount}`);
  lines.push("");
  lines.push("  Top 10 chunks:");
  for (const c of profile.chunks.slice(0, 10)) {
    const size = c.sizeBytes > 1024 * 1024 ? mb(c.sizeBytes) : kb(c.sizeBytes);
    lines.push(`    ${size.padStart(12)}  ${c.relativePath}`);
  }
  lines.push("");

  if (violations.length === 0) {
    lines.push("  ✅ Plugin pipeline within conservation budget.");
  } else {
    lines.push(`  ⚠️  ${violations.length} violation(s):`);
    for (const v of violations) {
      lines.push(`    • [${v.kind}] ${v.message}`);
    }
  }

  lines.push("═══════════════════════════════════════════════");
  return lines.join("\n");
}

// ─── CLI ──────────────────────────────────────────────────────────────

async function main() {
  const root = process.argv[2] || process.cwd();
  const budget = { ...DEFAULT_BUDGET };

  if (process.env.MAX_CONFIG_KB) budget.maxConfigKb = Number(process.env.MAX_CONFIG_KB);
  if (process.env.MAX_PLUGIN_COUNT) budget.maxPluginCount = Number(process.env.MAX_PLUGIN_COUNT);
  if (process.env.MAX_DIST_MB) budget.maxDistMb = Number(process.env.MAX_DIST_MB);
  if (process.env.MAX_CHUNK_KB) budget.maxChunkKb = Number(process.env.MAX_CHUNK_KB);

  const prof = await profileProject(root);
  const violations = detect(prof, budget);
  const report = formatReport(prof, violations, root);

  console.log(report);

  const jsonPath = join(root, "guardian-report.json");
  await writeFile(jsonPath, JSON.stringify({ profile: prof, violations, budget }, null, 2));
  console.log(`\n  JSON report → ${jsonPath}`);

  process.exit(violations.length > 0 ? 1 : 0);
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch(console.error);
}
