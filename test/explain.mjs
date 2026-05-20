import { explain } from "../lib/explain.mjs";
import { runner, assertEq, assertIncludes } from "./_runner.mjs";

const t = runner("ApiGate · explain");

const sampleReport = {
  endpoints: [
    {
      method: "GET",
      path: "/audit/security-events",
      file: "src/audit/audit.controller.ts",
      line: 488,
      framework: "nest",
      resolved: true,
      posture: "GUARDED",
      matchedAuthMarker: "ApiBearerAuth",
      authMarkers: ["ApiBearerAuth", "Controller", "Get"],
      risk: "MED",
      riskReason: "guarded write on sensitive path: audit"
    },
    {
      method: "POST",
      path: "/users/login",
      framework: "express",
      resolved: true,
      posture: "OPEN",
      matchedAuthMarker: null,
      authMarkers: [],
      intentionalPublic: true,
      risk: "LOW",
      riskReason: "intentional-public heuristic"
    }
  ],
  specsDetected: []
};

t.test("matches by method + path; emits posture + marker + risk", () => {
  const out = explain(sampleReport, "GET", "/audit/security-events");
  assertIncludes(out, "GET /audit/security-events");
  assertIncludes(out, "framework:        nest");
  assertIncludes(out, "posture:          GUARDED");
  assertIncludes(out, "matchedMarker:    ApiBearerAuth");
  assertIncludes(out, "risk:             MED");
  assertIncludes(out, "riskReason:");
});

t.test("path normalization: :id and {id} resolve to the same endpoint", () => {
  const r = {
    endpoints: [
      { method: "GET", path: "/users/:id", framework: "express", resolved: true, posture: "GUARDED" }
    ]
  };
  const a = explain(r, "GET", "/users/:id");
  const b = explain(r, "GET", "/users/{id}");
  assertEq(a, b);
});

t.test("intentional-public surfaces its flag", () => {
  const out = explain(sampleReport, "POST", "/users/login");
  assertIncludes(out, "intentionalPublic: true");
});

t.test("no-match prints near-matches by method", () => {
  const out = explain(sampleReport, "GET", "/nope");
  assertIncludes(out, "no endpoint matches");
  assertIncludes(out, "GET /audit/security-events");
});

t.test("refDiff surfaces added/changed lines", () => {
  const reportWithDiff = {
    endpoints: sampleReport.endpoints,
    specsDetected: [],
    refDiff: {
      baseRef: "main",
      baseSha: "abc12345dead",
      added: [{ method: "GET", path: "/audit/security-events" }],
      removed: [],
      changedPosture: [],
      changedRisk: []
    }
  };
  const out = explain(reportWithDiff, "GET", "/audit/security-events");
  assertIncludes(out, "refDiff:");
  assertIncludes(out, "added in this scan");
  assertIncludes(out, "abc12345");
});

t.test("byte-equal across two calls (deterministic)", () => {
  const a = explain(sampleReport, "GET", "/audit/security-events");
  const b = explain(sampleReport, "GET", "/audit/security-events");
  assertEq(a, b);
});

t.test("empty report payload does not throw", () => {
  const out = explain({}, "GET", "/x");
  assertIncludes(out, "empty report");
});

t.finish();
