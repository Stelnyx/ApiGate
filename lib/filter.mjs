/**
 * Endpoint view-filter.
 *
 * Filters are VIEW-ONLY: they narrow what the HTML endpoint table shows,
 * but never affect `summary`, `gate.reasons`, `headlineScore`, or exit
 * code. The full scan stays in the JSON; the filter is purely a reviewer
 * convenience for triaging large surfaces.
 *
 * Grammar (deterministic, minimal):
 *   key=value
 *   key=v1,v2          → OR within a key
 *   key1=v1,key2=v2    → AND across keys
 *
 * Allowed keys: risk, posture, framework, method, changed.
 *   `changed` requires --diff (added/removed/changedPosture/changedRisk).
 *
 * Unknown keys / unknown values throw — silent-ignore would mask CI typos.
 */

export const ALLOWED_KEYS = Object.freeze([
  "changed",
  "framework",
  "method",
  "posture",
  "risk"
]);

const ALLOWED_VALUES = Object.freeze({
  risk: ["HIGH", "MED", "LOW"],
  posture: ["GUARDED", "OPEN", "UNKNOWN"],
  framework: ["express", "fastify", "nest", "openapi"],
  // method: any HTTP verb is allowed (uppercased) — no enum lock.
  changed: ["added", "removed", "changedPosture", "changedRisk"]
});

export function parseFilter(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const filter = {};
  const parts = String(raw).split(",").map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      throw new Error(`--filter: expected key=value, got "${part}"`);
    }
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!ALLOWED_KEYS.includes(key)) {
      throw new Error(`--filter: unknown key "${key}". Valid: ${ALLOWED_KEYS.join(", ")}`);
    }
    if (!val) {
      throw new Error(`--filter: key "${key}" has empty value`);
    }
    const normalized = normalizeValue(key, val);
    if (!filter[key]) filter[key] = new Set();
    for (const v of normalized) filter[key].add(v);
  }
  return Object.keys(filter).length ? filter : null;
}

function normalizeValue(key, val) {
  // Split on '|' so a single key=A|B still parses, but our docs only
  // promote comma. Internal — kept for testability.
  const vals = val.split("|").map(s => s.trim()).filter(Boolean);
  const allowed = ALLOWED_VALUES[key];
  const out = [];
  for (let v of vals) {
    if (key === "risk" || key === "posture" || key === "method") v = v.toUpperCase();
    if (allowed && !allowed.includes(v)) {
      throw new Error(`--filter: unknown value "${v}" for key "${key}". Valid: ${allowed.join(", ")}`);
    }
    out.push(v);
  }
  return out;
}

export function describeFilter(filter) {
  if (!filter) return "";
  const parts = [];
  for (const key of ALLOWED_KEYS) {
    if (!filter[key]) continue;
    parts.push(`${key}=${[...filter[key]].sort().join(",")}`);
  }
  return parts.join(",");
}

/**
 * View-only filter applied to the endpoint list (and optionally to the
 * refDiff buckets when `changed=` is used).
 *
 * Returns a NEW array. Does not mutate input.
 */
export function applyFilter(endpoints, filter, { refDiff = null } = {}) {
  if (!filter) return [...endpoints];
  const changedSet = filter.changed ? collectChangedKeys(refDiff, filter.changed) : null;
  return endpoints.filter(e => matches(e, filter, changedSet));
}

function matches(e, filter, changedSet) {
  if (filter.risk && !filter.risk.has(String(e.risk || "").toUpperCase())) return false;
  if (filter.posture && !filter.posture.has(String(e.posture || "").toUpperCase())) return false;
  if (filter.framework && !filter.framework.has(String(e.framework || "").toLowerCase())) return false;
  if (filter.method && !filter.method.has(String(e.method || "").toUpperCase())) return false;
  if (changedSet) {
    const k = `${String(e.method || "").toUpperCase()} ${e.path || ""}`;
    if (!changedSet.has(k)) return false;
  }
  return true;
}

function collectChangedKeys(refDiff, changed) {
  const set = new Set();
  if (!refDiff || typeof refDiff !== "object") return set;
  for (const bucket of changed) {
    const arr = Array.isArray(refDiff[bucket]) ? refDiff[bucket] : [];
    for (const item of arr) {
      set.add(`${String(item.method || "").toUpperCase()} ${item.path || ""}`);
    }
  }
  return set;
}
