# Changelog

All notable changes to ApiGate are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-05-20

### Fixed
- HTML table cells (Path, Location) overflowed the viewport when long
  file paths contained no break characters (e.g.
  `src/auth/auth.controller.ts:50`). Path and Location `<code>` elements
  now use `word-break: break-all`, and every report table (endpoints,
  drift, refDiff, unknownReasons, parserCapabilities) is wrapped in an
  `overflow-x: auto` container so ultra-wide rows degrade to horizontal
  scroll instead of bleeding off the page.
- Surfaced via slstudio dogfood: 427-endpoint NestJS scan, `.ts` paths
  with no hyphens did not wrap. Determinism preserved — both fixes are
  constant template-literal attributes.

### Notes
- `v0.2.0` was tagged in git but never published to npm because of the
  overflow bug above. The registry goes `0.1.2 → 0.2.1`. All `v0.2.0`
  feature work (`--diff`, risk tier, `--filter`, `--explain`, layout
  reorder, vanilla JS) is included in `v0.2.1`.

## [0.2.0] - 2026-05-20 *(unreleased — never published to npm)*

### Added
- **`--diff <ref>` flag — PR-aware scanning.** Spins a detached git worktree
  at the resolved SHA, runs the same `buildInventory` + `classifyAll` +
  risk pipeline against the base tree, and emits `refDiff` with four
  buckets:
  ```jsonc
  "refDiff": {
    "baseRef": "main",
    "baseSha": "abc12345",
    "added":           [{ "method": "POST", "path": "/admin/purge", "risk": "HIGH" }],
    "removed":         [...],
    "changedPosture":  [{ "method": "PUT", "path": "/x", "from": "GUARDED", "to": "OPEN" }],
    "changedRisk":     [{ "method": "POST", "path": "/y", "from": "MED",   "to": "HIGH" }]
  }
  ```
  Worktree cleanup runs unconditionally in a `finally`. Stale worktrees
  from prior crashes are pruned at start.
- **Risk tier per endpoint (`risk` + `riskReason`).** Deterministic ladder
  using a frozen 9-token sensitive-path pattern list (`admin`, `auth`,
  `billing`, `delete`, `internal`, `password`, `secret`, `token`,
  `users`). HIGH at the top, MED in the middle, LOW at the bottom — the
  endpoint table is now sorted risk-DESC by default so the actionable
  surface lands first. Risk version locked at `v1`; see
  `parserCapabilities.riskTier` in the JSON report.
- **`--filter <expr>` flag — view-only narrowing.** Keys: `risk`,
  `posture`, `framework`, `method`, `changed`. Multiple values per key
  are OR; multiple keys are AND. Filter affects only the HTML endpoint
  table — `summary`, `gate.reasons`, `headlineScore`, and exit code
  always reflect the full scan. Unknown keys / values throw (CI typos
  cannot silently relax policy).
- **`--explain <method> <path>` flag.** Single-purpose evidence chain
  printer — prints file:line, posture, marked auth identifier, risk +
  reason, refDiff context, and OpenAPI presence for one endpoint. No
  file writes, exit 0 always. Path normalization aligns `/users/:id`
  with `/users/{id}` and `/users/<id>`.
- **HTML filter + sort.** Vanilla JS (~50 LOC), no dependencies, no
  `setInterval` / `Math.random` / `Date.now` / `fetch`. Text input above
  the endpoint table filters rows by visible cells; column header clicks
  toggle sort; filter + sort state mirrored to `location.hash` so links
  survive page reloads. Theme contract test asserts the JS is the only
  injected script and contains no non-deterministic primitives.
- **`new-open-write` gate reason.** Fires when `--diff` is active and
  the base→current diff added an OPEN write method. Default ON when
  `--diff` is provided. `--fail-on new-open-write` token added.
- **Risk override hook.** Existing reserved `config.severityOverrides`
  field is now live — pin specific `(method, path)` pairs to a fixed
  risk tier with a custom reason. Validated at config load.
- New test suites: `test/risk.mjs`, `test/diff.mjs`, `test/filter.mjs`,
  `test/explain.mjs`. Determinism + theme-contract tests gained
  assertions for risk, filter, refDiff, and the JS injection.
- New `parserCapabilities.riskTier` block + `report.riskVersion`
  top-level key — consumers can read the rubric version that produced
  the tier.

### Changed
- **HTML layout reorder.** Action material first, trust material last.
  New section order: Overview → PR changes (only with `--diff`) → Gate →
  Endpoints → Spec drift → Rubrics → Unknown reasons → ──── trust ────
  → Parser capabilities → Limitations. Capabilities + Limitations were
  moved BELOW the endpoint inventory so reviewers see the work surface
  first. Sidebar nav reflects the new order.
- **KPI grid prioritizes risk.** New "HIGH risk" + "MED risk" tiles at
  the top of the grid. Score-hero sub-line is now
  `HIGH · MED · LOW · status` instead of `guarded · open · unknown`.
- **Endpoint table gets a "Risk" column** (between Framework and
  Posture). Sorted risk-DESC, then method ASC, then path ASC.
- **`--help` is grouped by purpose**: Output, Investigation, Policy,
  Debug. `APIGATE_TIMESTAMP` env var now documented in `--help`.
- **Limitations gains a 5th statement** disclosing the risk tier is a
  pattern-based heuristic — not a runtime exploitability claim.

### Removed
- **`--deterministic` flag.** Overlapped with the `APIGATE_TIMESTAMP`
  env var (which matches the `SOURCE_DATE_EPOCH` convention). Set the
  env var in CI for byte-stable output. Non-breaking: no public scripts
  passed the flag.

### Flag count
| Version | Flags |
|---|---|
| 0.1.2 | 8 (`--output-dir --format --fail-on --strip-paths --deterministic --debug --version --help`) |
| 0.2.0 | 10 (drop `--deterministic`; add `--diff --filter --explain`) |

## [0.1.2] - 2026-05-19

### Added
- **`gate` object in the JSON report.** Every report now carries
  `gate: { status, reasons[] }` where `reasons` is a sorted, deduped array
  drawn from a locked enum (`drift`, `intentional-public`, `missing-spec`,
  `open-read`, `open-write`, `unknown-endpoint`). CI can grep the failure
  cause without scraping stdout. The terminal output also prints a
  `REASONS:` line on FAIL.
- **`matchedAuthMarker` per endpoint.** When an endpoint is GUARDED, the
  classifier records the first declared identifier that triggered the
  match (e.g. `passport.authenticate`). A reviewer can now distinguish a
  legitimate guard from a coincidental name without re-reading the source.
  Rendered in a new "Marker / Reason" column in the HTML endpoint table.
- **`parserCapabilities` matrix in the report.** A frozen, deterministic
  matrix per parser (Express / Fastify / NestJS / OpenAPI) describing
  exactly what each parser sees and what it intentionally leaves
  unresolved (e.g. Express cross-file mounts, Fastify register prefixes).
  Embedded in JSON and rendered as a dedicated HTML section. The honesty
  contract, machine-readable.
- **`summary.unknownReasons` bucket counts.** Standardized
  `unresolvedReason` strings from all parsers are summed into a
  deterministic `{reason: count}` object so "low inventory" becomes
  actionable triage instead of a vague penalty.
- **`--fail-on <list>` CLI flag.** Comma-separated tokens
  (`open-write,open-read,unknown,drift,intentional-public,missing-spec`)
  tighten exit-1 policy on top of `.apigate.config.json` without writing
  a file. Unknown tokens throw — CI typos can never silently relax
  policy.
- `test/gate.mjs` (gate resolution + flag parsing) and
  `test/capabilities.mjs` (matrix freeze + known-reasons sort) lock the
  new contracts.
- Theme contract test now also asserts that gate reasons,
  `parserCapabilities`, `matchedAuthMarker`, and `unknownReasons` all
  surface in the rendered HTML.

### Changed
- `apigate.js` `resolveStatus()` is replaced by the new `resolveGate()`
  in `lib/gate.mjs`. Status semantics are unchanged; the diff is that
  the reasons that drove the status are now first-class output.
- HTML report sidebar gains "Gate", "Unknown reasons", and "Parser
  capabilities" entries (the first two only when populated). Endpoint
  table gains a "Marker / Reason" column.
- `--help` documents the new flag and JSON keys.

## [0.1.1] - 2026-05-19

### Added
- **Intentional-public heuristic** (`lib/heuristics.mjs`). A deterministic
  exact-match pattern list flags common public-auth endpoints
  (login / signup / refresh / health / OAuth callbacks) as
  `intentionalPublic: true`. Default behavior:
    - Endpoints stay in the inventory and keep their declared posture.
    - They are excluded from the default exit-1 gate.
    - They are excluded from the Auth Coverage denominator.
    - They are tagged `PUBLIC` next to their posture in the HTML report.
  Configurable via `.apigate.config.json`: `publicAuthPatterns` (override
  the list, set `[]` to disable) and `failOn.intentionalPublic` (set
  `true` for strict / compliance mode — every open endpoint counts).
- A new line in the printed **"What this does NOT prove"** section
  discloses the heuristic and notes it can be wrong both ways.
- `test/heuristics.mjs` — pattern matching, override behavior, disable
  behavior, default list size.

### Changed
- **Auth Coverage formula.**
    - Before: `100 × guarded / (guarded + open)` — UNKNOWNs silently
      excluded from the denominator, which inflated the score.
    - After:  `100 × guarded / (guarded + open + unknown)` — UNKNOWNs
      count against coverage. Intentional-public endpoints are excluded
      from the denominator because they're declared public-by-design.
    - Rationale: an UNKNOWN endpoint is not a confirmed guard, and
      hiding it from the score contradicts the "static analysis cannot
      prove runtime authz" framing of the report.
    - Golden + score test expectations updated; the RealWorld sample
      moves to 100 / 100 because every open endpoint is now matched by
      the public-auth heuristic.
- **Report artifact renamed**: `apigate-v7-report.json` →
  `apigate-report.json` everywhere (writer, README, JSON schema docs,
  CI examples, sample, gitignore). The `v7` suffix had no provenance —
  killed the phantom.
- **OPEN-CORE.md** clarified: paid tiers may add convenience, scale,
  persistence, branding, or workflow on top of findings. They cannot
  redact or gate a finding (endpoint, posture, drift, disclosure) the
  OSS report would otherwise show.
- **RealWorld sample report** regenerated:
  20 endpoints — 17 guarded · 3 open · 0 unknown · 3 intentional-public.
  Headline 100 / 100 STRONG. STATUS: PASS (exit 0) by default.
  Strict mode still flags the 3 auth endpoints.
- README rubric table updated to match the new Auth Coverage formula
  exactly. New "Heuristic posture: public-by-design" section explains
  the contract and the strict opt-in path.

### Fixed
- `parsers/nest.mjs`: `@Controller({ path: 'x', version: '1' })` and
  `@Controller([...])` forms now resolve. (Dogfood surface against
  cirrus/slstudio production NestJS went from 26 / 423 resolved to
  423 / 423 after this fix; landed as the last commit of 0.1.0 and
  carried into 0.1.1.)

### Removed
- Committed `.a5c/cache/compression` agent-tooling artifact and added
  `.a5c/` to `.gitignore`. No build depends on it.

## [0.1.0] - 2026-05-19

### Added
- **Static API surface audit.** ApiGate enumerates HTTP endpoints from
  Express, Fastify, NestJS, and OpenAPI 2.0 / 3.x specs. Reads source on
  disk only — zero HTTP requests, no credentials, no telemetry.
- **Auth posture classifier.** Per-endpoint `GUARDED / OPEN / UNKNOWN`
  classification based on static presence of declared auth identifiers.
  Configurable per framework via `.apigate.config.json`.
- **Spec drift detection.** When an OpenAPI/Swagger doc is present, ApiGate
  emits `shadow` (code-only), `stale` (spec-only), and `authDrift`
  (posture mismatch in either direction) buckets.
- **Five-rubric headline score.** `inventoryResolved`, `authCoverage`,
  `openEndpointRisk`, `specDrift`, `determinism`. Headline = arithmetic
  mean of non-null rubrics. Rule version pinned at `v1`.
- **HTML + JSON output via `@stelnyx/report-theme@^0.1.0`.** Same shell,
  tokens, and component primitives as SecGate / LuxScope / LuxFaber. No
  local renderer, no fork. Limitations section ("What this does NOT prove")
  rendered in every report as a printed trust feature.
- **Determinism contract test** (`test/determinism.mjs`): JSON and HTML
  byte-equality across two runs of the full pipeline against the sample
  fixture. Closes the class of silent flakes caused by Map iteration,
  Set ordering, or hidden clocks.
- **Golden snapshot test** (`test/golden-apigate.mjs`): hand-crafted
  multi-framework fixture; expected endpoint count, posture distribution,
  drift buckets, rubric values, and headline score are inline so any
  drift surfaces as a literal diff in code review.
- **report-theme contract test** (`test/report-theme-contract.mjs`):
  asserts every report is rendered through the shared theme shell
  (`class="shell"`, `<aside>`, `<main>`, exactly one `<!doctype>`) and
  that `lib/report.mjs` never emits its own HTML document. Backed by an
  ESLint rule (`no-restricted-syntax`) forbidding `<!doctype` literals
  anywhere outside the theme call path.
- **Sample report.** [`samples/realworld-express/`](samples/realworld-express/)
  ships the rendered report for the canonical
  [RealWorld backend](https://github.com/gothinkster/node-express-realworld-example-app)
  (`30b68e1e881462b2f4164ea09ab4c4f5699c7b0b`), vendored under
  `test/fixtures/realworld-express/`.

### Notes
- This is the initial release. Subsequent versions follow SemVer; the rubric
  formula is locked at `v1` and any change to the locked golden numbers
  must be intentional and reviewed.
