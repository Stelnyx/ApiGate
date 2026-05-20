import { diffEndpoints } from "../lib/diff.mjs";
import { runner, assertEq } from "./_runner.mjs";

const t = runner("ApiGate · ref diff (diffEndpoints)");

function ep(method, p, posture, extra = {}) {
  return { method, path: p, posture, resolved: true, ...extra };
}

t.test("added: endpoint in current, not in base", () => {
  const d = diffEndpoints(
    [ep("POST", "/admin/purge", "OPEN", { risk: "HIGH" })],
    []
  );
  assertEq(d.added.length, 1);
  assertEq(d.added[0].method, "POST");
  assertEq(d.added[0].path, "/admin/purge");
  assertEq(d.added[0].posture, "OPEN");
  assertEq(d.added[0].risk, "HIGH");
});

t.test("removed: endpoint in base, not in current", () => {
  const d = diffEndpoints(
    [],
    [ep("GET", "/legacy", "GUARDED")]
  );
  assertEq(d.removed.length, 1);
  assertEq(d.removed[0].path, "/legacy");
});

t.test("changedPosture: GUARDED → OPEN flagged", () => {
  const d = diffEndpoints(
    [ep("PUT", "/users/:id", "OPEN")],
    [ep("PUT", "/users/:id", "GUARDED")]
  );
  assertEq(d.changedPosture.length, 1);
  assertEq(d.changedPosture[0].from, "GUARDED");
  assertEq(d.changedPosture[0].to, "OPEN");
});

t.test("changedRisk: MED → HIGH flagged when risk fields present", () => {
  const d = diffEndpoints(
    [ep("POST", "/billing/charge", "OPEN", { risk: "HIGH" })],
    [ep("POST", "/billing/charge", "OPEN", { risk: "MED" })]
  );
  assertEq(d.changedRisk.length, 1);
  assertEq(d.changedRisk[0].from, "MED");
  assertEq(d.changedRisk[0].to, "HIGH");
});

t.test("path normalization: :id and {id} key-match", () => {
  const d = diffEndpoints(
    [ep("GET", "/users/:id", "GUARDED")],
    [ep("GET", "/users/{id}", "GUARDED")]
  );
  assertEq(d.added.length, 0);
  assertEq(d.removed.length, 0);
  assertEq(d.changedPosture.length, 0);
});

t.test("unresolved endpoints excluded from both sides", () => {
  const d = diffEndpoints(
    [{ method: "GET", path: null, posture: "UNKNOWN", resolved: false }],
    [{ method: "GET", path: null, posture: "UNKNOWN", resolved: false }]
  );
  assertEq(d.added.length, 0);
  assertEq(d.removed.length, 0);
});

t.test("same posture + same risk = no entries", () => {
  const d = diffEndpoints(
    [ep("GET", "/x", "GUARDED", { risk: "LOW" })],
    [ep("GET", "/x", "GUARDED", { risk: "LOW" })]
  );
  assertEq(d.added.length, 0);
  assertEq(d.removed.length, 0);
  assertEq(d.changedPosture.length, 0);
  assertEq(d.changedRisk.length, 0);
});

t.test("results sorted method asc / path asc (deterministic)", () => {
  const d = diffEndpoints(
    [
      ep("POST", "/z", "OPEN"),
      ep("GET",  "/a", "OPEN"),
      ep("POST", "/a", "OPEN")
    ],
    []
  );
  assertEq(d.added.map(x => `${x.method} ${x.path}`).join("|"),
    "GET /a|POST /a|POST /z");
});

t.test("byte-equal across two calls", () => {
  const curr = [ep("POST", "/new", "OPEN", { risk: "HIGH" })];
  const base = [ep("GET", "/old", "GUARDED")];
  const a = JSON.stringify(diffEndpoints(curr, base));
  const b = JSON.stringify(diffEndpoints(curr, base));
  assertEq(a, b);
});

t.finish();
