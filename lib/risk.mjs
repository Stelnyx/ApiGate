/**
 * Per-endpoint risk tier — v1.
 *
 * Risk is impact × likelihood, computed deterministically from posture +
 * method + path tokens. Three buckets:
 *
 *   HIGH — OPEN write methods. The CI-blocking case.
 *   MED  — OPEN read on a sensitive path, UNKNOWN write, GUARDED write on
 *          a sensitive path (declared guard could be misconfigured).
 *   LOW  — everything else (declared guard, intentional-public, read on
 *          non-sensitive path).
 *
 * Each endpoint also gets `riskReason` — the human-readable rule that
 * triggered the tier. Reviewers can challenge a tier by inspecting the
 * reason rather than the underlying ladder.
 *
 * Trust note: risk is a *heuristic*, locked at v1, and surfaced in
 * `parserCapabilities.riskTier` so consumers know the rubric version.
 * False HIGHs are visible (loud); false LOWs are dampened by the
 * conservative ladder (sensitive-path tokens are biased toward LOUD).
 *
 * Pure function, frozen pattern list, no clock, no RNG.
 */

export const RISK_VERSION = "v1";

/**
 * Lowercased substring tokens. A path is "sensitive" if it contains any
 * token (slash-delimited segment OR substring — substring is more
 * permissive but deterministic). The list is intentionally short and
 * tightly scoped to high-blast-radius surfaces.
 *
 * Sorted lexicographically + deduped. Frozen.
 */
export const SENSITIVE_PATH_TOKENS_V1 = Object.freeze([
  "admin",
  "auth",
  "billing",
  "delete",
  "internal",
  "password",
  "secret",
  "token",
  "users"
]);

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const RISK_TIERS = Object.freeze(["HIGH", "MED", "LOW"]);

function sensitiveTokenIn(path) {
  if (!path) return null;
  const p = String(path).toLowerCase();
  for (const tok of SENSITIVE_PATH_TOKENS_V1) {
    if (p.includes(tok)) return tok;
  }
  return null;
}

export function computeRisk(endpoint) {
  if (!endpoint || typeof endpoint !== "object") {
    return { risk: "LOW", riskReason: "no endpoint payload" };
  }
  if (endpoint.intentionalPublic) {
    return { risk: "LOW", riskReason: "intentional-public heuristic" };
  }
  const method = String(endpoint.method || "").toUpperCase();
  const write = WRITE_METHODS.has(method);
  const posture = endpoint.posture;
  const token = sensitiveTokenIn(endpoint.path);

  if (posture === "OPEN") {
    if (write) return { risk: "HIGH", riskReason: "open write method" };
    if (token) return { risk: "MED", riskReason: `open read on sensitive path: ${token}` };
    return { risk: "LOW", riskReason: "open read on non-sensitive path" };
  }
  if (posture === "UNKNOWN") {
    if (write) return { risk: "MED", riskReason: "unknown posture on write method" };
    return { risk: "LOW", riskReason: "unknown posture on read method" };
  }
  if (posture === "GUARDED") {
    if (write && token) return { risk: "MED", riskReason: `guarded write on sensitive path: ${token}` };
    return { risk: "LOW", riskReason: "declared guard present" };
  }
  return { risk: "LOW", riskReason: "no posture" };
}

/**
 * Annotate an array of endpoints in-place. Override list comes second.
 * Override entries must match (method, path) exactly — no path
 * normalization here (the user wrote the override against the report's
 * canonical path, so we trust it).
 */
export function annotateRisk(endpoints, overrides = []) {
  const overrideMap = new Map();
  if (Array.isArray(overrides)) {
    for (const o of overrides) {
      if (!o || typeof o !== "object") continue;
      const m = String(o.method || "").toUpperCase();
      const p = String(o.path || "");
      const r = String(o.risk || "").toUpperCase();
      if (!m || !p || !RISK_TIERS.includes(r)) continue;
      overrideMap.set(`${m}|${p}`, { risk: r, reason: o.reason ? String(o.reason) : "user override" });
    }
  }
  return endpoints.map(e => {
    const base = computeRisk(e);
    const key = `${String(e.method || "").toUpperCase()}|${String(e.path || "")}`;
    const ov = overrideMap.get(key);
    if (ov) return { ...e, risk: ov.risk, riskReason: ov.reason };
    return { ...e, risk: base.risk, riskReason: base.riskReason };
  });
}
