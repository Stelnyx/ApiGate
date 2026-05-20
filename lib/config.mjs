import fs from "fs";
import path from "path";

export const CONFIG_DEFAULTS = Object.freeze({
  frameworks: { express: true, fastify: true, nest: true, openapi: true },
  auth: Object.freeze({
    express: Object.freeze([
      "requireAuth", "authenticate", "passport.authenticate",
      "ensureAuthenticated", "isAuthenticated", "verifyToken",
      "requireRole", "requireScope", "jwt", "checkJwt"
    ]),
    fastify: Object.freeze([
      "onRequest", "preHandler", "fastify.authenticate",
      "verifyJWT", "requireAuth"
    ]),
    nest: Object.freeze([
      "UseGuards", "Auth", "Roles", "ApiBearerAuth", "JwtAuthGuard", "AuthGuard"
    ])
  }),
  failOn: Object.freeze({
    openWriteMethods: true,
    openReadMethods: false,
    drift: false,
    unknown: false,
    // When false (default), endpoints flagged by the intentional-public
    // heuristic (login/signup/refresh/health/etc.) are excluded from the
    // exit-1 gate. Flip to true for a strict "every open endpoint fails"
    // policy. See lib/heuristics.mjs for the pattern list.
    intentionalPublic: false,
    // PR-aware: only meaningful when --diff is provided. Fires gate
    // reason "new-open-write" if the refDiff.added bucket contains any
    // OPEN write method that is not intentional-public.
    newOpenWrite: true
  }),
  // null = use the built-in DEFAULT_PUBLIC_AUTH_PATTERNS in lib/heuristics.mjs.
  // Provide an array of { method, path } to override entirely, or set to
  // an empty array to disable the heuristic.
  publicAuthPatterns: null,
  requireSpec: false,
  strictPublic: false,
  excludePaths: Object.freeze([
    "node_modules/**",
    "dist/**",
    "build/**",
    ".next/**",
    "**/*.test.*",
    "**/*.spec.*",
    "test/**",
    "tests/**",
    "__tests__/**"
  ]),
  severityOverrides: Object.freeze([])
});

function mergeAuth(rawAuth) {
  const out = {
    express: [...CONFIG_DEFAULTS.auth.express],
    fastify: [...CONFIG_DEFAULTS.auth.fastify],
    nest: [...CONFIG_DEFAULTS.auth.nest]
  };
  if (rawAuth && typeof rawAuth === "object") {
    for (const k of ["express", "fastify", "nest"]) {
      if (Array.isArray(rawAuth[k])) out[k] = rawAuth[k].map(String);
    }
  }
  return out;
}

function mergeFailOn(rawFailOn) {
  const out = { ...CONFIG_DEFAULTS.failOn };
  if (rawFailOn && typeof rawFailOn === "object") {
    if (typeof rawFailOn.openWriteMethods === "boolean") out.openWriteMethods = rawFailOn.openWriteMethods;
    if (typeof rawFailOn.openReadMethods === "boolean") out.openReadMethods = rawFailOn.openReadMethods;
    if (typeof rawFailOn.drift === "boolean") out.drift = rawFailOn.drift;
    if (typeof rawFailOn.unknown === "boolean") out.unknown = rawFailOn.unknown;
    if (typeof rawFailOn.intentionalPublic === "boolean") out.intentionalPublic = rawFailOn.intentionalPublic;
    if (typeof rawFailOn.newOpenWrite === "boolean") out.newOpenWrite = rawFailOn.newOpenWrite;
  }
  return out;
}

function mergeSeverityOverrides(raw) {
  if (!Array.isArray(raw)) return [];
  const ok = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    if (typeof o.method !== "string" || typeof o.path !== "string") continue;
    if (typeof o.risk !== "string") continue;
    ok.push({
      method: o.method,
      path: o.path,
      risk: o.risk,
      reason: typeof o.reason === "string" ? o.reason : ""
    });
  }
  return ok;
}

function mergePatterns(raw) {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(p => p && typeof p === "object" && typeof p.method === "string" && typeof p.path === "string")
    .map(p => ({ method: p.method, path: p.path }));
}

function mergeFrameworks(rawFw) {
  const out = { ...CONFIG_DEFAULTS.frameworks };
  if (rawFw && typeof rawFw === "object") {
    for (const k of ["express", "fastify", "nest", "openapi"]) {
      if (typeof rawFw[k] === "boolean") out[k] = rawFw[k];
    }
  }
  return out;
}

export function defaultConfig() {
  return {
    frameworks: { ...CONFIG_DEFAULTS.frameworks },
    auth: mergeAuth(null),
    failOn: { ...CONFIG_DEFAULTS.failOn },
    excludePaths: [...CONFIG_DEFAULTS.excludePaths],
    severityOverrides: [],
    publicAuthPatterns: null,
    requireSpec: false,
    strictPublic: false
  };
}

export function loadConfig(targetDir) {
  const cfgPath = path.join(targetDir, ".apigate.config.json");
  if (!fs.existsSync(cfgPath)) return defaultConfig();

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  } catch {
    console.error(`[apigate] Invalid JSON in ${cfgPath} — using defaults`);
    return defaultConfig();
  }

  return {
    frameworks: mergeFrameworks(raw.frameworks),
    auth: mergeAuth(raw.auth),
    failOn: mergeFailOn(raw.failOn),
    excludePaths: Array.isArray(raw.excludePaths) ? raw.excludePaths.map(String) : [...CONFIG_DEFAULTS.excludePaths],
    severityOverrides: mergeSeverityOverrides(raw.severityOverrides),
    publicAuthPatterns: mergePatterns(raw.publicAuthPatterns),
    requireSpec: typeof raw.requireSpec === "boolean" ? raw.requireSpec : CONFIG_DEFAULTS.requireSpec,
    strictPublic: typeof raw.strictPublic === "boolean" ? raw.strictPublic : CONFIG_DEFAULTS.strictPublic
  };
}
