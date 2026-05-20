import {
  shell as themeShell,
  scoreHero as themeScoreHero,
  kpiGrid as themeKpiGrid,
  bars as themeBars,
  findingsTable as themeFindingsTable,
} from "@stelnyx/report-theme";
import { bandFromScore } from "./score.mjs";

/**
 * The static-analysis honesty contract. Rendered in every report, never
 * hidden behind a toggle. This is the wedge of ApiGate: the report is
 * trustworthy because it tells you what it can't see.
 */
export const LIMITATIONS = Object.freeze([
  "Static analysis cannot verify runtime authorization (BOLA / object-level access). ApiGate only inspects declared auth posture, not the correctness of the auth middleware itself.",
  "An endpoint with a declared auth identifier in its middleware chain is classified GUARDED — the middleware may still be misconfigured, bypassable, or insecure at runtime.",
  "Routes mounted via dynamic strings (computed prefixes, runtime registration, factory functions) are reported as UNRESOLVED rather than guessed.",
  "ApiGate uses a built-in heuristic pattern list to mark common public-auth paths (login / signup / refresh / health / OAuth callbacks) as INTENTIONAL-PUBLIC. The heuristic is deterministic and configurable but can be wrong both ways — review the marked endpoints and override `publicAuthPatterns` in `.apigate.config.json` if your project disagrees.",
  "The per-endpoint `risk` tier (HIGH / MED / LOW) is a heuristic — pattern-based, frozen at `riskTier.version`. Use `severityOverrides` to pin specific endpoints. Risk is a triage aid, not a runtime exploitability claim.",
  "ApiGate makes ZERO network calls. It does not send code, telemetry, or scan artifacts anywhere. Reports are written to local files only."
]);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function postureTone(p) {
  if (p === "GUARDED") return "low";
  if (p === "OPEN") return "high";
  return "med";
}

function methodTone(m) {
  const write = m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
  return write ? "high" : "low";
}

function riskTone(r) {
  if (r === "HIGH") return "high";
  if (r === "MED") return "med";
  return "low";
}

function locationCell(e) {
  if (!e.file) return '<span style="color:var(--faint)">—</span>';
  const line = e.line ? `:${e.line}` : "";
  return `<code style="word-break:break-all;display:inline-block;max-width:100%">${escapeHtml(e.file + line)}</code>`;
}

function rubricBars(rubrics) {
  const labels = {
    inventoryResolved: "Inventory Resolved",
    authCoverage: "Auth Coverage",
    openEndpointRisk: "Open Endpoint Risk",
    specDrift: "Spec Drift",
    determinism: "Determinism"
  };
  const items = [];
  for (const key of ["inventoryResolved", "authCoverage", "openEndpointRisk", "specDrift", "determinism"]) {
    const val = rubrics[key];
    if (val === null || val === undefined) {
      items.push({ name: labels[key], score: "n/a", pct: 0, weight: "no spec", tone: "med" });
    } else {
      const tone = val >= 85 ? "default" : val >= 50 ? "med" : "warn";
      items.push({ name: labels[key], score: `${val}`, pct: val, weight: "", tone });
    }
  }
  return themeBars(items);
}

function gateReasonsSection(gate) {
  if (!gate || !Array.isArray(gate.reasons) || gate.reasons.length === 0) return "";
  const lis = gate.reasons.map(r => `<li><code>${escapeHtml(r)}</code></li>`).join("");
  return `<section id="gate" style="padding:14px 18px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-top:12px">
    <h3 style="margin:0 0 6px">Gate reasons</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 8px">CI exit-1 fired on the following deterministic, enum-locked reasons:</p>
    <ul style="font-size:13px;line-height:1.7;padding-left:20px;margin:0">${lis}</ul>
  </section>`;
}

function refDiffSection(refDiff) {
  if (!refDiff) return "";
  const totals = ["added", "removed", "changedPosture", "changedRisk"]
    .map(k => (refDiff[k] || []).length)
    .reduce((a, b) => a + b, 0);
  if (totals === 0) {
    return `<section id="ref-diff" style="padding:14px 18px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-top:12px">
      <h3 style="margin:0 0 6px">PR changes <span class="lead">vs ${escapeHtml(refDiff.baseRef)} (${escapeHtml(refDiff.baseSha.slice(0, 8))})</span></h3>
      <p style="color:var(--muted);font-size:13px;margin:0">No endpoint differences against the base.</p>
    </section>`;
  }
  const rows = [];
  for (const a of refDiff.added || []) rows.push({
    severity: { label: "Added", tone: "high" },
    cells: [escapeHtml(a.method), `<code>${escapeHtml(a.path || "")}</code>`, escapeHtml(a.posture || ""), riskPill(a.risk)]
  });
  for (const c of refDiff.changedPosture || []) rows.push({
    severity: { label: "Posture", tone: c.to === "OPEN" ? "high" : "med" },
    cells: [escapeHtml(c.method), `<code>${escapeHtml(c.path || "")}</code>`, `${escapeHtml(c.from)} → ${escapeHtml(c.to)}`, ""]
  });
  for (const c of refDiff.changedRisk || []) rows.push({
    severity: { label: "Risk", tone: c.to === "HIGH" ? "high" : "med" },
    cells: [escapeHtml(c.method), `<code>${escapeHtml(c.path || "")}</code>`, "", `${escapeHtml(c.from)} → ${escapeHtml(c.to)}`]
  });
  for (const r of refDiff.removed || []) rows.push({
    severity: { label: "Removed", tone: "med" },
    cells: [escapeHtml(r.method), `<code>${escapeHtml(r.path || "")}</code>`, escapeHtml(r.posture || ""), ""]
  });
  return `<section id="ref-diff">
    <h2>PR changes <span class="lead">vs ${escapeHtml(refDiff.baseRef)} (${escapeHtml(refDiff.baseSha.slice(0, 8))})</span></h2>
    <div style="overflow-x:auto;max-width:100%">${themeFindingsTable({
      columns: ["Kind", "Method", "Path", "Posture", "Risk"],
      rows
    })}</div>
  </section>`;
}

function unknownReasonsSection(summary) {
  const reasons = summary?.unknownReasons || {};
  const keys = Object.keys(reasons).sort();
  if (keys.length === 0) return "";
  const rows = keys.map(k => ({
    severity: { label: String(reasons[k]), tone: "med" },
    cells: [`<code>${escapeHtml(k)}</code>`, "Buckets per parser-emitted unresolvedReason. Counts derived from endpoints flagged UNRESOLVED."]
  }));
  return `<div style="overflow-x:auto;max-width:100%">${themeFindingsTable({
    columns: ["Count", "Reason", "Detail"],
    rows
  })}</div>`;
}

function parserCapabilitiesSection(caps) {
  if (!caps) return "";
  const parsers = Object.keys(caps).sort();
  const rows = [];
  for (const p of parsers) {
    const obj = caps[p];
    const keys = Object.keys(obj).sort();
    for (const k of keys) {
      const v = obj[k];
      let valueCell;
      if (v === true) valueCell = '<span class="pill low">yes</span>';
      else if (v === false) valueCell = '<span class="pill high">no</span>';
      else valueCell = `<span style="color:var(--muted);font-size:12px">${escapeHtml(String(v))}</span>`;
      rows.push({
        severity: { label: p, tone: "med" },
        cells: [`<code>${escapeHtml(k)}</code>`, valueCell]
      });
    }
  }
  return `<div style="overflow-x:auto;max-width:100%">${themeFindingsTable({
    columns: ["Parser", "Capability", "Behavior"],
    rows
  })}</div>`;
}

function limitationsSection() {
  const lis = LIMITATIONS.map(l => `<li style="margin-bottom:8px">${escapeHtml(l)}</li>`).join("");
  return `<section id="limitations" style="padding:18px 20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-top:12px">
    <h2 style="margin-top:0">What this does NOT prove</h2>
    <p style="color:var(--muted);font-size:13px;margin-top:4px">
      ApiGate is a deterministic, static surface auditor. The points below are not footnotes — they are the contract of what a static report can and cannot tell you. Read them every time.
    </p>
    <ol style="color:var(--text);font-size:13px;line-height:1.7;padding-left:20px;margin-top:12px">${lis}</ol>
  </section>`;
}

function riskPill(r) {
  if (!r) return '<span style="color:var(--faint)">—</span>';
  return `<span class="pill ${riskTone(r)}">${escapeHtml(r)}</span>`;
}

function postureCell(e) {
  const tag = `<span class="pill ${postureTone(e.posture)}">${escapeHtml(e.posture)}</span>`;
  if (e.intentionalPublic) {
    return `${tag} <span class="pill low" title="Matched a built-in public-auth pattern (login/signup/refresh/health/...). Heuristic — see Limitations.">PUBLIC</span>`;
  }
  return tag;
}

function markerCell(e) {
  if (e.matchedAuthMarker) {
    return `<code title="The first declared auth identifier that matched this endpoint's middleware/decorator chain. Check .apigate.config.json &gt; auth if it looks wrong.">${escapeHtml(e.matchedAuthMarker)}</code>`;
  }
  if (e.resolved === false || e.posture === "UNKNOWN") {
    if (e.unresolvedReason) {
      return `<span style="color:var(--faint);font-size:12px">${escapeHtml(e.unresolvedReason)}</span>`;
    }
    return '<span style="color:var(--faint)">—</span>';
  }
  return '<span style="color:var(--faint)">—</span>';
}

/**
 * Endpoint table sorted by risk DESC, then method ASC, then path ASC.
 * HIGH rows land at the top so reviewers see the actionable surface first.
 */
function sortEndpointsForTable(endpoints) {
  const rank = { HIGH: 0, MED: 1, LOW: 2 };
  return [...endpoints].sort((a, b) => {
    const ra = rank[a.risk] ?? 3;
    const rb = rank[b.risk] ?? 3;
    if (ra !== rb) return ra - rb;
    if (a.method !== b.method) return a.method < b.method ? -1 : 1;
    if ((a.path || "") !== (b.path || "")) return (a.path || "") < (b.path || "") ? -1 : 1;
    return 0;
  });
}

function endpointTable(endpoints) {
  if (!endpoints.length) {
    return `<p style="color:var(--faint);font-size:13px">No endpoints discovered.</p>`;
  }
  const sorted = sortEndpointsForTable(endpoints);
  const rows = sorted.map(e => ({
    severity: { label: e.method, tone: methodTone(e.method) },
    cells: [
      e.resolved !== false
        ? `<code style="word-break:break-all">${escapeHtml(e.path || "")}</code>`
        : `<code style="color:var(--warn)">UNRESOLVED</code>`,
      escapeHtml(e.framework),
      riskPill(e.risk),
      postureCell(e),
      markerCell(e),
      locationCell(e)
    ]
  }));
  // Wrap the theme table in an overflow-x container so very long paths
  // get a horizontal scroll fallback instead of bleeding off the page.
  return `<div style="overflow-x:auto;max-width:100%">${themeFindingsTable({
    columns: ["Method", "Path", "Framework", "Risk", "Posture", "Marker / Reason", "Location"],
    rows
  })}</div>`;
}

function driftTable(drift) {
  const all = [
    ...(drift.shadow || []).map(d => ({ ...d, label: "Shadow" })),
    ...(drift.stale || []).map(d => ({ ...d, label: "Stale" })),
    ...(drift.authDrift || []).map(d => ({ ...d, label: d.kind === "authDriftDeclaredOnly" ? "Auth drift (code open)" : "Auth drift (code guarded)" }))
  ];
  if (!all.length) {
    return `<p style="color:var(--faint);font-size:13px">No spec drift detected.</p>`;
  }
  const rows = all.map(d => ({
    severity: { label: d.label, tone: d.kind === "stale" ? "med" : "high" },
    cells: [
      escapeHtml(d.method || ""),
      `<code style="word-break:break-all">${escapeHtml(d.path || "")}</code>`,
      escapeHtml(d.note || "")
    ]
  }));
  return `<div style="overflow-x:auto;max-width:100%">${themeFindingsTable({
    columns: ["Kind", "Method", "Path", "Note"],
    rows
  })}</div>`;
}

/**
 * Vanilla JS — filter + sort the endpoint table client-side. Frozen at
 * v0.2: no setInterval, no Math.random, no Date.now, no fetch. Output is
 * a constant template literal so HTML byte-equality across runs holds.
 *
 * Behavior:
 *   - Text input above the endpoint table filters rows by visible cells.
 *   - Click column header toggles sort asc/desc.
 *   - State is mirrored to location.hash so links survive (#filter=...).
 */
function tableInteractivityScript() {
  return `<script>
(function(){
  var section = document.getElementById('endpoints');
  if (!section) return;
  var table = section.querySelector('table');
  if (!table) return;
  var input = document.getElementById('endpoint-filter');
  if (!input) return;
  var tbody = table.querySelector('tbody') || table;
  var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));

  function applyFilter(q) {
    var needle = (q || '').toLowerCase();
    var shown = 0;
    rows.forEach(function(row) {
      var text = row.textContent.toLowerCase();
      var match = needle === '' || text.indexOf(needle) !== -1;
      row.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    var counter = document.getElementById('endpoint-filter-count');
    if (counter) counter.textContent = shown + ' / ' + rows.length + ' visible';
  }

  function parseHash() {
    var h = (location.hash || '').replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function(p) {
      var i = p.indexOf('=');
      if (i > 0) out[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1));
    });
    return out;
  }
  function writeHash(state) {
    var parts = [];
    Object.keys(state).sort().forEach(function(k) {
      if (state[k] !== '' && state[k] != null) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(state[k]));
    });
    var h = parts.join('&');
    if (h) history.replaceState(null, '', '#' + h);
    else history.replaceState(null, '', location.pathname + location.search);
  }

  var hash = parseHash();
  if (hash.filter) { input.value = hash.filter; applyFilter(hash.filter); } else applyFilter('');

  input.addEventListener('input', function() {
    applyFilter(input.value);
    var h = parseHash();
    h.filter = input.value;
    writeHash(h);
  });

  var headers = Array.prototype.slice.call(table.querySelectorAll('thead th, th'));
  headers.forEach(function(th, i) {
    th.style.cursor = 'pointer';
    th.addEventListener('click', function() {
      var dir = th.getAttribute('data-sort') === 'asc' ? 'desc' : 'asc';
      headers.forEach(function(h) { h.removeAttribute('data-sort'); h.textContent = h.textContent.replace(/[ ▲▼]+$/, ''); });
      th.setAttribute('data-sort', dir);
      th.textContent = th.textContent.replace(/[ ▲▼]+$/, '') + (dir === 'asc' ? ' ▲' : ' ▼');
      var sorted = rows.slice().sort(function(a, b) {
        var av = (a.children[i] && a.children[i].textContent || '').trim();
        var bv = (b.children[i] && b.children[i].textContent || '').trim();
        if (av === bv) return 0;
        var an = Number(av), bn = Number(bv);
        if (!isNaN(an) && !isNaN(bn)) return dir === 'asc' ? an - bn : bn - an;
        return dir === 'asc' ? (av < bv ? -1 : 1) : (av < bv ? 1 : -1);
      });
      sorted.forEach(function(r) { tbody.appendChild(r); });
      var h = parseHash();
      h.sort = i + ':' + dir;
      writeHash(h);
    });
  });

  if (hash.sort) {
    var parts = hash.sort.split(':');
    var idx = parseInt(parts[0], 10);
    var dir = parts[1] === 'desc' ? 'desc' : 'asc';
    if (!isNaN(idx) && headers[idx]) {
      if (dir === 'desc') headers[idx].setAttribute('data-sort', 'asc'); // toggle flips it
      headers[idx].click();
    }
  }
})();
</script>`;
}

/**
 * Render the full ApiGate HTML report by composing report-theme primitives.
 * The shell, sidebar chrome, fonts, colors, and dark/light tokens all come
 * from @stelnyx/report-theme — ApiGate never emits its own HTML document.
 */
export function renderHtml(rep, targetLabel) {
  const headline = rep.headlineScore ?? 0;
  const band = bandFromScore(headline);
  const status = rep.status;
  const sum = rep.summary;
  const specPresent = (rep.specsDetected || []).length > 0;
  const visibleEndpoints = rep._visibleEndpoints || rep.endpoints;
  const filterActive = typeof rep.filter === "string" && rep.filter.length > 0;

  const heroDesc = "ApiGate inventories every HTTP endpoint, classifies auth posture (GUARDED / OPEN / UNKNOWN), assigns a risk tier per endpoint, and diffs the surface against any declared OpenAPI spec. 100% static — no network, no credentials, deterministic.";

  const unknownReasonKeys = Object.keys(rep.summary?.unknownReasons || {});
  const hasGateReasons = Array.isArray(rep.gate?.reasons) && rep.gate.reasons.length > 0;
  const hasRefDiff = !!rep.refDiff;
  const refDiffCount = hasRefDiff
    ? (rep.refDiff.added?.length || 0) + (rep.refDiff.removed?.length || 0) + (rep.refDiff.changedPosture?.length || 0) + (rep.refDiff.changedRisk?.length || 0)
    : 0;

  // Layout reorder (v0.2): action material first, trust material last.
  const navItems = [
    { id: "overview", label: "Overview", active: true },
    ...(hasRefDiff ? [{ id: "ref-diff", label: "PR changes", count: refDiffCount }] : []),
    ...(hasGateReasons ? [{ id: "gate", label: "Gate", count: rep.gate.reasons.length }] : []),
    { id: "endpoints", label: "Endpoints", count: visibleEndpoints.length },
    ...(specPresent ? [{ id: "drift", label: "Spec drift", count: (rep.drift.shadow?.length || 0) + (rep.drift.stale?.length || 0) + (rep.drift.authDrift?.length || 0) }] : []),
    { id: "rubrics", label: "Rubrics", count: 5 },
    ...(unknownReasonKeys.length ? [{ id: "unknown-reasons", label: "Unknown reasons", count: unknownReasonKeys.length }] : []),
    { id: "parser-capabilities", label: "Parser capabilities" },
    { id: "limitations", label: "Limitations" }
  ];

  const riskSum = sum.risk || { HIGH: 0, MED: 0, LOW: 0 };
  const kpis = [
    { label: "Endpoints", value: sum.endpoints },
    { label: "HIGH risk", value: riskSum.HIGH, tone: riskSum.HIGH > 0 ? "high" : "low" },
    { label: "MED risk", value: riskSum.MED, tone: riskSum.MED > 0 ? "med" : "low" },
    { label: "Guarded", value: sum.guarded, tone: "low" },
    { label: "Open", value: sum.open, tone: sum.open > 0 ? "high" : "low" },
    { label: "Unknown", value: sum.unknown, tone: "med" },
    { label: "Shadow", value: sum.shadow, tone: sum.shadow > 0 ? "med" : "low" },
    { label: "Stale", value: sum.stale, tone: sum.stale > 0 ? "med" : "low" }
  ];

  const filterPill = filterActive
    ? `<div style="display:inline-block;padding:4px 10px;margin-bottom:12px;background:var(--surface);border:1px solid var(--border);border-radius:99px;font-size:12px;color:var(--muted)">FILTER ACTIVE — <code>${escapeHtml(rep.filter)}</code> · ${visibleEndpoints.length} / ${rep.endpoints.length} visible</div>`
    : "";

  const endpointSearch = `<div style="display:flex;align-items:center;gap:12px;margin:8px 0 10px">
    <input id="endpoint-filter" type="text" placeholder="Type to filter rows…" style="flex:1;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px" />
    <span id="endpoint-filter-count" style="color:var(--muted);font-size:12px">${visibleEndpoints.length} / ${visibleEndpoints.length} visible</span>
  </div>`;

  const bodyHtml = `
    <section id="overview">
      <h1>API surface <span class="lead">${escapeHtml(rep.endpoints.length)} endpoints · ${escapeHtml((rep.frameworksDetected || []).join(", ") || "no framework detected")}</span></h1>
      ${themeScoreHero({
        label: "Headline",
        num: headline,
        denom: `/ 100  ${band}`,
        sub: `${riskSum.HIGH} HIGH · ${riskSum.MED} MED · ${riskSum.LOW} LOW · status ${status}`,
        fillPct: headline,
        fillColor: status === "PASS" ? "success" : "warn",
        desc: heroDesc
      })}
      ${themeKpiGrid(kpis)}
    </section>

    ${refDiffSection(rep.refDiff)}

    ${gateReasonsSection(rep.gate)}

    <section id="endpoints">
      <h2>Endpoint inventory <span class="lead">${escapeHtml(visibleEndpoints.length)} of ${escapeHtml(rep.endpoints.length)} · sorted risk DESC, then method/path</span></h2>
      ${filterPill}
      ${endpointSearch}
      ${endpointTable(visibleEndpoints)}
    </section>

    ${specPresent ? `<section id="drift">
      <h2>Spec drift <span class="lead">${escapeHtml((rep.specsDetected || []).join(", "))}</span></h2>
      ${driftTable(rep.drift || {})}
    </section>` : ""}

    <section id="rubrics">
      <h2>Rubrics <span class="lead">five 0–100 scores · headline = arithmetic mean of non-null rubrics</span></h2>
      ${rubricBars(rep.rubrics)}
    </section>

    ${unknownReasonKeys.length ? `<section id="unknown-reasons">
      <h2>Unknown reasons <span class="lead">${escapeHtml(unknownReasonKeys.length)} bucket${unknownReasonKeys.length === 1 ? "" : "s"}</span></h2>
      <p style="color:var(--muted);font-size:13px;margin:0 0 8px">Why ApiGate couldn't resolve some endpoints to a static method/path. Each bucket points to actionable code — usually a dynamic mount prefix or a computed route string.</p>
      ${unknownReasonsSection(rep.summary)}
    </section>` : ""}

    <hr style="border:none;border-top:1px solid var(--border);margin:32px 0 18px" />
    <p style="color:var(--faint);font-size:11px;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px">Trust / audit material</p>

    <section id="parser-capabilities">
      <h2>Parser capabilities <span class="lead">what each parser sees and what it intentionally does not</span></h2>
      <p style="color:var(--muted);font-size:13px;margin:0 0 8px">The honesty contract, machine-readable. This matrix is frozen at the published apigate version (<code>${escapeHtml(rep.version || "")}</code>) and the same data is in the JSON report under <code>parserCapabilities</code>.</p>
      ${parserCapabilitiesSection(rep.parserCapabilities)}
    </section>

    ${limitationsSection()}

    ${tableInteractivityScript()}
  `;

  return themeShell({
    brand: "APIGATE",
    target: targetLabel || rep.target || "",
    meta: `v${rep.version} · rubric ${rep.rubricVersion || "v1"} · risk ${rep.riskVersion || "v1"}`,
    tier: { label: status, tone: status === "PASS" ? "pass" : "warn" },
    product: "ApiGate Report",
    score: {
      num: headline,
      denom: "/ 100",
      badge: { label: status, tone: status === "PASS" ? "pass" : "warn" }
    },
    reportType: `API · ${band}`,
    reportTypeFooter: "API Surface Report",
    reportPill: "API REPORT",
    navLabel: "Report",
    nav: navItems,
    bodyHtml,
    title: `ApiGate Report — ${targetLabel || rep.target || "scan"}`,
    reportVersion: `v${rep.version}`,
    generatedAt: rep.timestamp
  });
}
