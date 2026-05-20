#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { loadConfig } from "./lib/config.mjs";
import { buildInventory } from "./lib/inventory.mjs";
import { classifyAll } from "./lib/auth.mjs";
import { diff as specDiff } from "./lib/drift.mjs";
import { computeScore, SCORE_VERSION, bandFromScore } from "./lib/score.mjs";
import { renderHtml, LIMITATIONS } from "./lib/report.mjs";
import { annotateIntentionalPublic, DEFAULT_PUBLIC_AUTH_PATTERNS } from "./lib/heuristics.mjs";
import { resolveGate, parseFailOnFlag } from "./lib/gate.mjs";
import { PARSER_CAPABILITIES, KNOWN_UNRESOLVED_REASONS, RISK_TIER_INFO } from "./lib/capabilities.mjs";
import { annotateRisk } from "./lib/risk.mjs";
import { buildRefDiff } from "./lib/diff.mjs";
import { parseFilter, applyFilter, describeFilter } from "./lib/filter.mjs";
import { explain } from "./lib/explain.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));

const argv = process.argv.slice(2);

if (argv.includes("--version") || argv.includes("-v")) {
  console.log(pkg.version);
  process.exit(0);
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`
░▒▓█ APIGATE █▓▒░  v${pkg.version}
Static API surface audit — Express · Fastify · NestJS · OpenAPI 2/3

Usage:
  apigate [target] [options]

Output:
  --output-dir <dir>     Directory to write report files (default: target)
  --format <fmt>         Output formats: 'json,html' (default), 'json', 'html'

Investigation:
  --diff <ref>           Compare current scan to git <ref>. Emits refDiff
                         (added/removed/changedPosture/changedRisk) and
                         enables the new-open-write gate.
  --filter <expr>        Narrow the visible endpoint table (view-only —
                         summary + gate are always derived from the full
                         scan). Tokens:
                           risk=HIGH|MED|LOW
                           posture=GUARDED|OPEN|UNKNOWN
                           framework=express|fastify|nest|openapi
                           method=GET|POST|...
                           changed=added|removed|changedPosture|changedRisk
                         Example: --filter risk=HIGH,posture=OPEN
  --explain <m> <path>   Print one endpoint's evidence chain to stdout
                         (file, posture, marker, risk, refDiff). No files
                         written. Exit 0 always.

Policy:
  --fail-on <list>       Comma list, tightens exit-1 policy on top of config.
                         Tokens: open-write, open-read, unknown, drift,
                         intentional-public, new-open-write, missing-spec

Debug:
  --strip-paths          Relativize target to repo basename (auto-on if CI=true)
  --debug                Print parser warnings to stderr
  --version, -v          Print version and exit
  --help, -h             Show this help

Environment:
  APIGATE_TIMESTAMP=<iso> Override the timestamp in the report. Set this
                         in CI for byte-stable output across runs.

Config file (.apigate.config.json in target):
  frameworks         Toggle parsers: { express, fastify, nest, openapi }
  auth               Per-framework auth identifier names
  failOn             Exit-code policy: { openWriteMethods, openReadMethods,
                                         unknown, drift, intentionalPublic,
                                         newOpenWrite }
  requireSpec        Exit 1 when no OpenAPI spec is found
  strictPublic       Disable built-in public-auth patterns unless explicitly
                     configured
  severityOverrides  Pin specific (method, path) to a risk tier:
                     [{ "method": "POST", "path": "/admin/wipe",
                        "risk": "LOW", "reason": "scheduled only" }]
  excludePaths       Glob list of files to skip
  See .apigate.config.example.json for a fully-commented template.

Exit codes:
  0  PASS — gate.reasons is empty
  1  FAIL — gate.reasons[] lists the exact gate(s) that fired
  2  Invalid target or CLI error

Output files:
  apigate-report.json    Machine-readable JSON report (gate, refDiff,
                         parserCapabilities, riskTier, ...)
  <repo-name>.html       Self-contained HTML report (via @stelnyx/report-theme)

ApiGate makes zero network calls. No code or telemetry leaves the machine.
`);
  process.exit(0);
}

function argValue(flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) return null;
  return v;
}

function explainArgs() {
  const i = argv.indexOf("--explain");
  if (i === -1) return null;
  const method = argv[i + 1];
  const epath = argv[i + 2];
  if (!method || method.startsWith("--") || !epath || epath.startsWith("--")) {
    console.error('--explain requires <method> <path>, e.g. --explain GET /users/:id');
    process.exit(2);
  }
  return { method, path: epath };
}

const rawTarget = argv[0] && !argv[0].startsWith("--") ? argv[0] : ".";
const DEBUG = argv.includes("--debug");
const STRIP_PATHS = argv.includes("--strip-paths") || process.env.CI === "true";
const OUTPUT_DIR_FLAG = argValue("--output-dir");
const FORMAT_RAW = argValue("--format");
const FORMAT_SET = new Set((FORMAT_RAW || "json,html").split(",").map(s => s.trim().toLowerCase()));
const FAIL_ON_FLAG = argValue("--fail-on");
const DIFF_REF = argValue("--diff");
const FILTER_RAW = argValue("--filter");
const EXPLAIN = explainArgs();

const target = path.resolve(rawTarget);
if (!fs.existsSync(target)) {
  console.error(`Target not found: ${rawTarget}`);
  process.exit(2);
}
if (!fs.statSync(target).isDirectory()) {
  console.error(`Target is not a directory: ${rawTarget}`);
  process.exit(2);
}

const outputDir = OUTPUT_DIR_FLAG ? path.resolve(OUTPUT_DIR_FLAG) : target;
if (OUTPUT_DIR_FLAG && !fs.existsSync(outputDir)) {
  try { fs.mkdirSync(outputDir, { recursive: true }); }
  catch (e) {
    console.error(`Cannot create --output-dir ${outputDir}: ${e.message}`);
    process.exit(2);
  }
}

const repoName = path.basename(path.resolve(target));
const reportTarget = STRIP_PATHS ? repoName : target;

const config = loadConfig(target);

if (FAIL_ON_FLAG !== null) {
  try {
    const { failOn: overrides, requireSpec } = parseFailOnFlag(FAIL_ON_FLAG);
    config.failOn = { ...config.failOn, ...overrides };
    if (requireSpec) config.requireSpec = true;
  } catch (e) {
    console.error(`[apigate] ${e.message}`);
    process.exit(2);
  }
}

let filter = null;
if (FILTER_RAW !== null) {
  try { filter = parseFilter(FILTER_RAW); }
  catch (e) {
    console.error(`[apigate] ${e.message}`);
    process.exit(2);
  }
}

// EXPLAIN mode silences the banner so stdout is a clean evidence chain
// when piped to a tool.
if (!EXPLAIN) {
  console.log(`
░▒▓█ APIGATE v${pkg.version} █▓▒░`);
  console.log("Target:", reportTarget);
  console.log("Mode:   STATIC");
  console.log("────────────────────────────────");
}

const inventory = buildInventory(target, config);
const patterns = config.publicAuthPatterns ?? (config.strictPublic ? [] : DEFAULT_PUBLIC_AUTH_PATTERNS);
const codeClassified = annotateIntentionalPublic(classifyAll(inventory.code, config), patterns);
const specClassified = annotateIntentionalPublic(classifyAll(inventory.spec, config), patterns);
const codeWithRisk = annotateRisk(codeClassified, config.severityOverrides);
const driftResult = inventory.spec.length > 0
  ? specDiff(codeWithRisk, specClassified)
  : { shadow: [], stale: [], authDrift: [] };

let refDiff = null;
if (DIFF_REF) {
  try {
    refDiff = buildRefDiff({
      ref: DIFF_REF,
      repoRoot: target,
      currentEndpoints: codeWithRisk,
      config
    });
  } catch (e) {
    console.error(`[apigate] --diff ${DIFF_REF}: ${e.message}`);
    process.exit(2);
  }
}

const allEndpoints = [...codeWithRisk, ...specClassified];
const summary = summarize(codeWithRisk, specClassified, driftResult);
const { headline, rubrics } = computeScore({
  endpoints: codeWithRisk,
  drift: driftResult,
  specPresent: inventory.spec.length > 0
});
const gate = resolveGate({
  code: codeWithRisk,
  drift: driftResult,
  config,
  specPresent: inventory.spec.length > 0,
  refDiff
});
const status = gate.status;

const timestamp = process.env.APIGATE_TIMESTAMP
  ? process.env.APIGATE_TIMESTAMP
  : new Date().toISOString();

const report = {
  version: pkg.version,
  rubricVersion: SCORE_VERSION,
  riskVersion: RISK_TIER_INFO.version,
  timestamp,
  target: reportTarget,
  mode: "static",
  status,
  gate,
  headlineScore: headline,
  rubrics,
  summary,
  endpoints: allEndpoints.map(stripInternal),
  drift: driftResult,
  ...(refDiff ? { refDiff } : {}),
  frameworksDetected: inventory.frameworksDetected,
  specsDetected: inventory.specsDetected,
  parserCapabilities: PARSER_CAPABILITIES,
  riskTier: RISK_TIER_INFO,
  ...(filter ? { filter: describeFilter(filter) } : {}),
  warnings: inventory.warnings,
  limitations: [...LIMITATIONS]
};

// EXPLAIN short-circuits: print one endpoint to stdout, no files, exit 0.
if (EXPLAIN) {
  process.stdout.write(explain(report, EXPLAIN.method, EXPLAIN.path));
  process.exit(0);
}

const visibleEndpoints = filter
  ? applyFilter(report.endpoints, filter, { refDiff })
  : report.endpoints;

const renderedReport = { ...report, _visibleEndpoints: visibleEndpoints };

const jsonFile = path.join(outputDir, "apigate-report.json");
const htmlFile = path.join(outputDir, `${repoName}.html`);

if (FORMAT_SET.has("json")) {
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2) + "\n");
}
if (FORMAT_SET.has("html")) {
  fs.writeFileSync(htmlFile, renderHtml(renderedReport, repoName));
}

const bar = (() => {
  const filled = Math.round(headline / 5);
  return "█".repeat(filled) + "░".repeat(20 - filled);
})();

console.log(`Headline:  ${headline} / 100   ${bar}   ${bandFromScore(headline)}  rubric ${SCORE_VERSION}`);
console.log("");
for (const [key, val] of Object.entries(rubrics)) {
  const label = ({
    inventoryResolved: "Inventory",
    authCoverage: "Auth Coverage",
    openEndpointRisk: "Open Risk",
    specDrift: "Spec Drift",
    determinism: "Determinism"
  })[key] || key;
  const v = val === null ? "  n/a" : String(val).padStart(5);
  const sub = val === null ? "                    " : "█".repeat(Math.round(val / 5)).padEnd(20, "░");
  console.log(`  ${label.padEnd(14)} ${v} / 100   ${sub}`);
}
console.log("────────────────────────────────");
console.log("STATUS:    ", status);
if (gate.reasons.length) {
  console.log("REASONS:   ", gate.reasons.join(", "));
}
console.log("ENDPOINTS: ", summary.endpoints, ` (${summary.guarded} guarded, ${summary.open} open, ${summary.unknown} unknown, ${summary.intentionalPublic} intentional-public)`);
console.log("RISK:      ", `${summary.risk.HIGH} high · ${summary.risk.MED} med · ${summary.risk.LOW} low`);
if (inventory.spec.length > 0) {
  console.log("DRIFT:     ", `${driftResult.shadow.length} shadow, ${driftResult.stale.length} stale, ${driftResult.authDrift.length} auth-drift`);
}
if (refDiff) {
  console.log("DIFF vs",  refDiff.baseRef, `(${refDiff.baseSha.slice(0, 8)}):`, `${refDiff.added.length} added, ${refDiff.removed.length} removed, ${refDiff.changedPosture.length} posture-changed, ${refDiff.changedRisk.length} risk-changed`);
}
if (filter) {
  console.log("FILTER:    ", describeFilter(filter), `(${visibleEndpoints.length}/${report.endpoints.length} visible)`);
}
console.log("");

if (DEBUG && inventory.warnings.length) {
  console.error("Parser warnings:");
  for (const w of inventory.warnings) console.error(`  ${w.file}: ${w.reason}`);
}

if (FORMAT_SET.has("json")) console.log("JSON report:", jsonFile);
if (FORMAT_SET.has("html")) console.log("HTML report:", htmlFile);

console.log("");
console.log("Note: static analysis cannot verify runtime authorization (BOLA / object-level access).");
console.log("      See the 'Limitations' section of the report.");

process.exit(status === "PASS" ? 0 : 1);

function summarize(code, spec, drift) {
  const counts = {
    endpoints: code.length,
    resolved: 0,
    unresolved: 0,
    guarded: 0,
    open: 0,
    unknown: 0,
    intentionalPublic: 0,
    risk: { HIGH: 0, MED: 0, LOW: 0 },
    specEndpoints: spec.length,
    shadow: drift.shadow?.length || 0,
    stale: drift.stale?.length || 0,
    authDrift: drift.authDrift?.length || 0,
    unknownReasons: {}
  };
  const reasonCounts = {};
  for (const reason of KNOWN_UNRESOLVED_REASONS) reasonCounts[reason] = 0;

  for (const e of code) {
    if (e.resolved === false) {
      counts.unresolved++;
      const reason = e.unresolvedReason || "unspecified";
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    } else {
      counts.resolved++;
    }
    if (e.intentionalPublic) counts.intentionalPublic++;
    if (e.posture === "GUARDED") counts.guarded++;
    else if (e.posture === "OPEN") counts.open++;
    else counts.unknown++;
    if (e.risk === "HIGH" || e.risk === "MED" || e.risk === "LOW") counts.risk[e.risk]++;
  }
  for (const key of Object.keys(reasonCounts).sort()) {
    if (reasonCounts[key] > 0) counts.unknownReasons[key] = reasonCounts[key];
  }
  return counts;
}

function stripInternal(e) {
  const out = { ...e };
  delete out.declaredPosture;
  return out;
}
