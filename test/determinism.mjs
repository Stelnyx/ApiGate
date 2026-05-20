// Determinism contract — identical inputs MUST produce JSON-byte-identical
// outputs. Locks the parsers, classifier, drift, score, and report renderer
// against silent flakes (Map iteration order, Set ordering, hidden clocks).

import path from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../lib/config.mjs";
import { buildInventory } from "../lib/inventory.mjs";
import { classifyAll } from "../lib/auth.mjs";
import { diff } from "../lib/drift.mjs";
import { computeScore } from "../lib/score.mjs";
import { renderHtml } from "../lib/report.mjs";
import { annotateRisk } from "../lib/risk.mjs";
import { parseFilter, applyFilter } from "../lib/filter.mjs";
import { runner, assertEq } from "./_runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(__dirname, "fixtures", "sample-app");
const t = runner("ApiGate · determinism");

function buildReport() {
  const cfg = loadConfig(fixture);
  const inv = buildInventory(fixture, cfg);
  const code = annotateRisk(classifyAll(inv.code, cfg), cfg.severityOverrides);
  const spec = classifyAll(inv.spec, cfg);
  const dr = diff(code, spec);
  const sc = computeScore({ endpoints: code, drift: dr, specPresent: spec.length > 0 });
  const riskCounts = { HIGH: 0, MED: 0, LOW: 0 };
  for (const e of code) if (riskCounts[e.risk] !== undefined) riskCounts[e.risk]++;
  return {
    version: "0.2.0",
    rubricVersion: "v1",
    riskVersion: "v1",
    timestamp: "2026-01-01T00:00:00.000Z",
    target: "sample-app",
    mode: "static",
    status: "FAIL",
    gate: { status: "FAIL", reasons: ["open-write"] },
    headlineScore: sc.headline,
    rubrics: sc.rubrics,
    summary: {
      endpoints: code.length,
      resolved: code.filter(e => e.resolved !== false).length,
      unresolved: code.filter(e => e.resolved === false).length,
      guarded: code.filter(e => e.posture === "GUARDED").length,
      open: code.filter(e => e.posture === "OPEN").length,
      unknown: code.filter(e => e.posture === "UNKNOWN").length,
      intentionalPublic: code.filter(e => e.intentionalPublic).length,
      risk: riskCounts,
      specEndpoints: spec.length,
      shadow: dr.shadow.length,
      stale: dr.stale.length,
      authDrift: dr.authDrift.length,
      unknownReasons: {}
    },
    endpoints: [...code, ...spec],
    drift: dr,
    frameworksDetected: inv.frameworksDetected,
    specsDetected: inv.specsDetected,
    warnings: inv.warnings,
    limitations: []
  };
}

t.test("buildInventory: code endpoints byte-equal across two runs", () => {
  const cfg = loadConfig(fixture);
  const a = JSON.stringify(buildInventory(fixture, cfg).code);
  const b = JSON.stringify(buildInventory(fixture, cfg).code);
  assertEq(a, b, "inventory code JSON equal");
});

t.test("classifyAll: byte-equal output across two runs", () => {
  const cfg = loadConfig(fixture);
  const inv = buildInventory(fixture, cfg);
  const a = JSON.stringify(classifyAll(inv.code, cfg));
  const b = JSON.stringify(classifyAll(inv.code, cfg));
  assertEq(a, b);
});

t.test("diff: byte-equal output across two runs", () => {
  const cfg = loadConfig(fixture);
  const inv = buildInventory(fixture, cfg);
  const code = classifyAll(inv.code, cfg);
  const spec = classifyAll(inv.spec, cfg);
  const a = JSON.stringify(diff(code, spec));
  const b = JSON.stringify(diff(code, spec));
  assertEq(a, b);
});

t.test("computeScore: byte-equal output across two runs", () => {
  const cfg = loadConfig(fixture);
  const inv = buildInventory(fixture, cfg);
  const code = classifyAll(inv.code, cfg);
  const spec = classifyAll(inv.spec, cfg);
  const dr = diff(code, spec);
  const a = JSON.stringify(computeScore({ endpoints: code, drift: dr, specPresent: true }));
  const b = JSON.stringify(computeScore({ endpoints: code, drift: dr, specPresent: true }));
  assertEq(a, b);
});

t.test("full report JSON byte-equal across two runs (fixed timestamp)", () => {
  const a = JSON.stringify(buildReport(), null, 2);
  const b = JSON.stringify(buildReport(), null, 2);
  assertEq(a, b, "report JSON equal");
});

t.test("rendered HTML byte-equal across two runs (fixed timestamp)", () => {
  const a = renderHtml(buildReport(), "sample-app");
  const b = renderHtml(buildReport(), "sample-app");
  assertEq(a, b, "report HTML equal");
});

t.test("annotateRisk: byte-equal output across two runs", () => {
  const cfg = loadConfig(fixture);
  const inv = buildInventory(fixture, cfg);
  const a = JSON.stringify(annotateRisk(classifyAll(inv.code, cfg), cfg.severityOverrides));
  const b = JSON.stringify(annotateRisk(classifyAll(inv.code, cfg), cfg.severityOverrides));
  assertEq(a, b);
});

t.test("applyFilter: filtered HTML byte-equal across two runs", () => {
  const rep = buildReport();
  const filter = parseFilter("risk=HIGH,posture=OPEN");
  const filtered = applyFilter(rep.endpoints.filter(e => e.framework !== "openapi"), filter);
  const a = renderHtml({ ...rep, _visibleEndpoints: filtered, filter: "posture=OPEN,risk=HIGH" }, "sample-app");
  const b = renderHtml({ ...rep, _visibleEndpoints: filtered, filter: "posture=OPEN,risk=HIGH" }, "sample-app");
  assertEq(a, b);
});

t.finish();
