/**
 * Gate resolver.
 *
 * Produces { status: "PASS" | "FAIL", reasons: [...] } where `reasons` is a
 * sorted, deterministic, deduped array of failure reason codes drawn from a
 * locked enum. The CLI maps a non-empty reasons list to exit code 1 and
 * embeds the object verbatim into the JSON report so CI can grep without
 * scraping stdout.
 *
 * Enum is frozen — new reason codes require a version bump.
 */
export const GATE_REASONS = Object.freeze([
  "drift",
  "intentional-public",
  "missing-spec",
  "new-open-write",
  "open-read",
  "open-write",
  "unknown-endpoint"
]);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function resolveGate({ code, drift, config, specPresent, refDiff = null }) {
  const reasons = new Set();
  const failOn = config.failOn;

  if (config.requireSpec && !specPresent) reasons.add("missing-spec");

  for (const e of code) {
    if (e.posture === "UNKNOWN" && failOn.unknown) {
      if (e.intentionalPublic && !failOn.intentionalPublic) continue;
      reasons.add("unknown-endpoint");
    }
    if (e.posture !== "OPEN") continue;
    if (e.intentionalPublic) {
      if (failOn.intentionalPublic) reasons.add("intentional-public");
      continue;
    }
    const m = String(e.method || "").toUpperCase();
    const write = WRITE_METHODS.has(m);
    if (write && failOn.openWriteMethods) reasons.add("open-write");
    if (!write && failOn.openReadMethods) reasons.add("open-read");
  }
  if (failOn.drift && (drift.shadow?.length || drift.stale?.length || drift.authDrift?.length)) {
    reasons.add("drift");
  }
  // newOpenWrite fires when --diff is active AND failOn.newOpenWrite is on.
  // The intent: "did this PR introduce a new unauthenticated write?". Only
  // OPEN write methods count (intentional-public ones are excluded so a new
  // /login doesn't trip the gate).
  if (failOn.newOpenWrite && refDiff && Array.isArray(refDiff.added)) {
    for (const a of refDiff.added) {
      const m = String(a.method || "").toUpperCase();
      if (!WRITE_METHODS.has(m)) continue;
      if (a.posture !== "OPEN") continue;
      if (a.intentionalPublic) continue;
      reasons.add("new-open-write");
      break;
    }
  }

  const sorted = [...reasons].sort();
  return {
    status: sorted.length === 0 ? "PASS" : "FAIL",
    reasons: sorted
  };
}

/**
 * Parse a `--fail-on a,b,c` CLI value into a partial failOn override object.
 * Unknown tokens throw — CI typos should not silently relax policy.
 */
export const FAIL_ON_TOKEN_MAP = Object.freeze({
  "open-write": "openWriteMethods",
  "open-read": "openReadMethods",
  "unknown": "unknown",
  "drift": "drift",
  "intentional-public": "intentionalPublic",
  "new-open-write": "newOpenWrite"
});

export function parseFailOnFlag(raw) {
  if (raw === null || raw === undefined || raw === "") return { failOn: {}, requireSpec: undefined };
  const tokens = String(raw).split(",").map(s => s.trim()).filter(Boolean);
  const failOn = {};
  let requireSpec;
  for (const tok of tokens) {
    if (tok === "missing-spec") {
      requireSpec = true;
      continue;
    }
    const key = FAIL_ON_TOKEN_MAP[tok];
    if (!key) {
      throw new Error(`--fail-on: unknown token "${tok}". Valid: ${[...Object.keys(FAIL_ON_TOKEN_MAP), "missing-spec"].sort().join(", ")}`);
    }
    failOn[key] = true;
  }
  return { failOn, requireSpec };
}
