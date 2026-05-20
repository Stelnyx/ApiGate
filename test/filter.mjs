import { parseFilter, applyFilter, describeFilter, ALLOWED_KEYS } from "../lib/filter.mjs";
import { runner, assertEq } from "./_runner.mjs";

const t = runner("ApiGate · filter");

function ep(method, p, posture, risk, framework = "express") {
  return { method, path: p, posture, risk, framework };
}

t.test("ALLOWED_KEYS is sorted, frozen", () => {
  const sorted = [...ALLOWED_KEYS].sort();
  assertEq(JSON.stringify(ALLOWED_KEYS), JSON.stringify(sorted));
  try { ALLOWED_KEYS.push("x"); } catch (e) { return; }
  throw new Error("ALLOWED_KEYS must be frozen");
});

t.test("parseFilter: empty/null returns null", () => {
  assertEq(parseFilter(null), null);
  assertEq(parseFilter(""), null);
});

t.test("parseFilter: single key=value", () => {
  const f = parseFilter("risk=HIGH");
  assertEq(f.risk instanceof Set, true);
  assertEq(f.risk.has("HIGH"), true);
});

t.test("parseFilter: multiple keys = AND", () => {
  const f = parseFilter("risk=HIGH,posture=OPEN");
  assertEq(f.risk.has("HIGH"), true);
  assertEq(f.posture.has("OPEN"), true);
});

t.test("parseFilter: value-pipe (HIGH|MED) = OR within a key", () => {
  const f = parseFilter("risk=HIGH|MED");
  assertEq(f.risk.has("HIGH"), true);
  assertEq(f.risk.has("MED"), true);
  assertEq(f.risk.has("LOW"), false);
});

t.test("parseFilter: case-normalizes risk/posture/method", () => {
  const f = parseFilter("risk=high,posture=open,method=post");
  assertEq(f.risk.has("HIGH"), true);
  assertEq(f.posture.has("OPEN"), true);
  assertEq(f.method.has("POST"), true);
});

t.test("parseFilter: unknown key throws", () => {
  try { parseFilter("bogus=1"); } catch (e) {
    if (!e.message.includes("bogus")) throw new Error("expected error to mention key");
    return;
  }
  throw new Error("expected parseFilter to throw on unknown key");
});

t.test("parseFilter: unknown value throws", () => {
  try { parseFilter("risk=BOGUS"); } catch (e) {
    if (!e.message.includes("BOGUS")) throw new Error("expected error to mention value");
    return;
  }
  throw new Error("expected parseFilter to throw on unknown value");
});

t.test("parseFilter: malformed (no =) throws", () => {
  try { parseFilter("riskHIGH"); } catch (e) { return; }
  throw new Error("expected parseFilter to throw on malformed token");
});

t.test("applyFilter: null filter passes through (copy)", () => {
  const eps = [ep("GET", "/a", "OPEN", "LOW")];
  const out = applyFilter(eps, null);
  assertEq(out.length, 1);
  assertEq(out !== eps, true); // new array
});

t.test("applyFilter: risk=HIGH narrows to HIGH only", () => {
  const eps = [
    ep("POST", "/a", "OPEN", "HIGH"),
    ep("GET",  "/b", "OPEN", "LOW")
  ];
  const out = applyFilter(eps, parseFilter("risk=HIGH"));
  assertEq(out.length, 1);
  assertEq(out[0].path, "/a");
});

t.test("applyFilter: AND across keys", () => {
  const eps = [
    ep("POST", "/a", "OPEN",    "HIGH"),
    ep("POST", "/b", "GUARDED", "LOW")
  ];
  const out = applyFilter(eps, parseFilter("risk=HIGH,posture=OPEN"));
  assertEq(out.length, 1);
  assertEq(out[0].path, "/a");
});

t.test("applyFilter: framework filter", () => {
  const eps = [
    ep("GET", "/a", "OPEN", "LOW", "express"),
    ep("GET", "/b", "OPEN", "LOW", "nest")
  ];
  const out = applyFilter(eps, parseFilter("framework=nest"));
  assertEq(out.length, 1);
  assertEq(out[0].framework, "nest");
});

t.test("applyFilter: changed=added narrows to refDiff.added entries", () => {
  const eps = [
    ep("POST", "/new", "OPEN", "HIGH"),
    ep("GET",  "/old", "GUARDED", "LOW")
  ];
  const refDiff = { added: [{ method: "POST", path: "/new" }] };
  const out = applyFilter(eps, parseFilter("changed=added"), { refDiff });
  assertEq(out.length, 1);
  assertEq(out[0].path, "/new");
});

t.test("describeFilter: emits canonical sorted form", () => {
  const f = parseFilter("posture=OPEN,risk=HIGH|MED");
  assertEq(describeFilter(f), "posture=OPEN,risk=HIGH,MED");
});

t.test("describeFilter: null → empty string", () =>
  assertEq(describeFilter(null), ""));

t.finish();
