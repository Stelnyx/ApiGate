import { normalizeMethod, normalizePath } from "./utils.mjs";

/**
 * Print one endpoint's evidence chain.
 *
 * Single-purpose query: takes the in-memory report and a method+path,
 * returns a deterministic stdout string. No file writes, no side effects.
 * Path matching uses the same normalization as the drift/diff modules, so
 * `--explain GET /users/:id` and `--explain GET /users/{id}` resolve to
 * the same endpoint.
 */
export function explain(report, method, path) {
  if (!report || !Array.isArray(report.endpoints)) {
    return "explain: empty report (no endpoints scanned).\n";
  }
  const wantMethod = normalizeMethod(method);
  const wantPath = normalizePath(path);
  const match = report.endpoints.find(e =>
    normalizeMethod(e.method) === wantMethod &&
    normalizePath(e.path) === wantPath
  );
  if (!match) {
    const candidates = report.endpoints
      .filter(e => normalizeMethod(e.method) === wantMethod)
      .map(e => `  ${e.method} ${e.path || "<unresolved>"}`)
      .slice(0, 10)
      .join("\n");
    const tail = candidates ? `\n\nNear matches (same method):\n${candidates}\n` : "";
    return `explain: no endpoint matches ${wantMethod} ${wantPath}.${tail}\n`;
  }
  return formatMatch(match, report);
}

function formatMatch(e, report) {
  const lines = [];
  lines.push(`${e.method} ${e.path || "<unresolved>"}`);
  lines.push(`  framework:        ${e.framework}`);
  lines.push(`  resolved:         ${e.resolved !== false}`);
  if (e.file) {
    lines.push(`  file:             ${e.file}${e.line ? `:${e.line}` : ""}`);
  }
  lines.push(`  posture:          ${e.posture}`);
  if (e.matchedAuthMarker) {
    lines.push(`  matchedMarker:    ${e.matchedAuthMarker}`);
  }
  if (Array.isArray(e.authMarkers) && e.authMarkers.length) {
    lines.push(`  authMarkers:      ${e.authMarkers.join(", ")}`);
  }
  if (e.intentionalPublic) {
    lines.push(`  intentionalPublic: true (matched public-auth heuristic)`);
  }
  if (e.risk) {
    lines.push(`  risk:             ${e.risk}`);
    if (e.riskReason) lines.push(`  riskReason:       ${e.riskReason}`);
  }
  if (e.unresolvedReason) {
    lines.push(`  unresolvedReason: ${e.unresolvedReason}`);
  }

  // refDiff context
  const refDiff = report.refDiff;
  if (refDiff) {
    const refLine = describeRefDiff(e, refDiff);
    if (refLine) lines.push(`  refDiff:          ${refLine}`);
  }

  // Spec presence
  if (Array.isArray(report.specsDetected) && report.specsDetected.length) {
    const inSpec = (report.endpoints || []).some(s =>
      s.framework === "openapi" &&
      normalizeMethod(s.method) === normalizeMethod(e.method) &&
      normalizePath(s.path) === normalizePath(e.path)
    );
    lines.push(`  spec:             ${inSpec ? "declared in OpenAPI" : "NOT in OpenAPI"}`);
  }

  lines.push("");
  return lines.join("\n");
}

function describeRefDiff(e, refDiff) {
  const k = `${normalizeMethod(e.method)} ${e.path || ""}`;
  const baseSha = refDiff.baseSha ? ` (base ${refDiff.baseSha.slice(0, 8)})` : "";
  const has = (bucket) => Array.isArray(refDiff[bucket]) && refDiff[bucket].some(x =>
    `${normalizeMethod(x.method)} ${x.path || ""}` === k);
  if (has("added")) return `added in this scan${baseSha}`;
  if (has("removed")) return `removed since base${baseSha}`;
  const cp = (refDiff.changedPosture || []).find(x =>
    `${normalizeMethod(x.method)} ${x.path || ""}` === k);
  if (cp) return `posture changed ${cp.from} → ${cp.to}${baseSha}`;
  const cr = (refDiff.changedRisk || []).find(x =>
    `${normalizeMethod(x.method)} ${x.path || ""}` === k);
  if (cr) return `risk changed ${cr.from} → ${cr.to}${baseSha}`;
  return "";
}
