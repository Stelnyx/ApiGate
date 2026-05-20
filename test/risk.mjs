import {
  RISK_VERSION,
  SENSITIVE_PATH_TOKENS_V1,
  RISK_TIERS,
  computeRisk,
  annotateRisk
} from "../lib/risk.mjs";
import { runner, assertEq } from "./_runner.mjs";

const t = runner("ApiGate · risk tier");

t.test("RISK_VERSION pinned at v1", () => assertEq(RISK_VERSION, "v1"));

t.test("SENSITIVE_PATH_TOKENS_V1 is sorted, deduped, frozen", () => {
  const sorted = [...SENSITIVE_PATH_TOKENS_V1].sort();
  assertEq(JSON.stringify(SENSITIVE_PATH_TOKENS_V1), JSON.stringify(sorted));
  assertEq(new Set(SENSITIVE_PATH_TOKENS_V1).size, SENSITIVE_PATH_TOKENS_V1.length);
  try { SENSITIVE_PATH_TOKENS_V1.push("x"); } catch (e) { return; }
  throw new Error("SENSITIVE_PATH_TOKENS_V1 must be frozen");
});

t.test("RISK_TIERS frozen at HIGH/MED/LOW", () =>
  assertEq(JSON.stringify(RISK_TIERS), JSON.stringify(["HIGH", "MED", "LOW"])));

t.test("intentional-public always LOW", () => {
  const r = computeRisk({ method: "POST", path: "/admin/purge", posture: "OPEN", intentionalPublic: true });
  assertEq(r.risk, "LOW");
  assertEq(r.riskReason, "intentional-public heuristic");
});

t.test("OPEN + write → HIGH", () => {
  const r = computeRisk({ method: "POST", path: "/anything", posture: "OPEN" });
  assertEq(r.risk, "HIGH");
  assertEq(r.riskReason, "open write method");
});

t.test("OPEN + read + sensitive path → MED with token", () => {
  const r = computeRisk({ method: "GET", path: "/admin/dashboard", posture: "OPEN" });
  assertEq(r.risk, "MED");
  assertEq(r.riskReason, "open read on sensitive path: admin");
});

t.test("OPEN + read + non-sensitive path → LOW", () => {
  const r = computeRisk({ method: "GET", path: "/health", posture: "OPEN" });
  assertEq(r.risk, "LOW");
  assertEq(r.riskReason, "open read on non-sensitive path");
});

t.test("UNKNOWN + write → MED", () => {
  const r = computeRisk({ method: "PUT", path: "/x", posture: "UNKNOWN" });
  assertEq(r.risk, "MED");
});

t.test("UNKNOWN + read → LOW", () => {
  const r = computeRisk({ method: "GET", path: "/x", posture: "UNKNOWN" });
  assertEq(r.risk, "LOW");
});

t.test("GUARDED + write + sensitive → MED", () => {
  const r = computeRisk({ method: "DELETE", path: "/users/:id", posture: "GUARDED" });
  assertEq(r.risk, "MED");
  assertEq(r.riskReason, "guarded write on sensitive path: users");
});

t.test("GUARDED + read + sensitive → LOW (guard present)", () => {
  const r = computeRisk({ method: "GET", path: "/billing/invoices", posture: "GUARDED" });
  assertEq(r.risk, "LOW");
});

t.test("annotateRisk preserves order + tags each endpoint", () => {
  const eps = [
    { method: "POST", path: "/a", posture: "OPEN" },
    { method: "GET", path: "/b", posture: "GUARDED" }
  ];
  const out = annotateRisk(eps);
  assertEq(out.length, 2);
  assertEq(out[0].risk, "HIGH");
  assertEq(out[1].risk, "LOW");
});

t.test("overrides win over the ladder (exact method+path match)", () => {
  const eps = [{ method: "POST", path: "/admin/wipe", posture: "OPEN" }];
  const out = annotateRisk(eps, [{ method: "POST", path: "/admin/wipe", risk: "LOW", reason: "scheduled maintenance only" }]);
  assertEq(out[0].risk, "LOW");
  assertEq(out[0].riskReason, "scheduled maintenance only");
});

t.test("invalid override entries are silently ignored", () => {
  const eps = [{ method: "POST", path: "/a", posture: "OPEN" }];
  const out = annotateRisk(eps, [
    { method: "POST", path: "/a", risk: "BOGUS" },
    { method: "POST", path: "/a", risk: "" },
    null,
    "string-not-object"
  ]);
  assertEq(out[0].risk, "HIGH"); // ladder still applies
});

t.test("output is deterministic across two calls", () => {
  const eps = [
    { method: "GET", path: "/users/me", posture: "GUARDED" },
    { method: "POST", path: "/billing/charge", posture: "OPEN" }
  ];
  const a = JSON.stringify(annotateRisk(eps));
  const b = JSON.stringify(annotateRisk(eps));
  assertEq(a, b);
});

t.finish();
