<!-- markdownlint-disable MD033 MD041 -->

<div align="center">

# ApiGate

**A single-command static API surface audit.**

Express · Fastify · NestJS · OpenAPI 2/3
One command. One report. One exit code.

<p>
  <a href="https://www.npmjs.com/package/@stelnyx/apigate"><img alt="npm" src="https://img.shields.io/npm/v/@stelnyx/apigate.svg?style=flat-square&labelColor=0a0a0a&color=00cc66"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-00cc66.svg?style=flat-square&labelColor=0a0a0a"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-00cc66.svg?style=flat-square&labelColor=0a0a0a">
  <img alt="provenance" src="https://img.shields.io/badge/npm%20provenance-signed-00cc66.svg?style=flat-square&labelColor=0a0a0a">
  <a href="SECURITY.md"><img alt="security" src="https://img.shields.io/badge/security-policy-00cc66.svg?style=flat-square&labelColor=0a0a0a"></a>
  <a href="https://github.com/Stelnyx/ApiGate/actions/workflows/ci.yml"><img alt="self-scan" src="https://github.com/Stelnyx/ApiGate/actions/workflows/ci.yml/badge.svg?branch=main"></a>
</p>

</div>

---

**ApiGate** is the fourth surface in the Stelnyx line ([LuxScope](https://github.com/Stelnyx/LuxScope), [LuxFaber](https://github.com/Stelnyx/LuxFaber), [SecGate](https://github.com/Stelnyx/SecGate), **ApiGate**). It reads source code and OpenAPI specs on disk and produces one report: every endpoint, its declared auth posture, the drift between code and spec, scored against five 0–100 rubrics. **100% static** — no HTTP requests, no credentials, no running server. Zero network calls. Same input → byte-identical output.

**Honest positioning.** ApiGate is a **surface auditor**, not a runtime scanner and not a DAST tool. The report explicitly states what a static analysis CAN and CANNOT prove — it's a printed trust feature, not a footnote. ApiGate cannot verify runtime authorization (BOLA / object-level access). It can prove that an endpoint declares a guard. It cannot prove the guard is correct. See [What this does NOT prove](#what-this-does-not-prove).

**Status.** Early release (`v0.2.0`). Published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). Report vulnerabilities via [SECURITY.md](SECURITY.md).

**Accuracy contract.** ApiGate's parsing + scoring pipeline is deterministic — same inputs produce JSON- and HTML-byte-identical reports across every run. Three test suites lock the contract:

- `test/determinism.mjs` — byte-equality of JSON and HTML across reruns of every parser, classifier, diff, score, and renderer call.
- `test/golden-apigate.mjs` — hand-crafted multi-framework fixture; expected endpoint count, posture distribution, drift buckets, and headline score are inline so any change surfaces in code review.
- `test/report-theme-contract.mjs` — asserts the HTML report is rendered through `@stelnyx/report-theme`, not by a parallel local renderer.

---

## Headline Score

Every run produces a **Headline Score (0–100)** alongside the binary PASS/FAIL gate. The score is the arithmetic mean of five 0–100 rubrics:

```
Headline:  86 / 100   █████████████████░░░   STRONG  rubric v1

  Inventory         86 / 100   █████████████████░░░
  Auth Coverage     67 / 100   █████████████░░░░░░░
  Open Risk         85 / 100   █████████████████░░░
  Spec Drift        90 / 100   ██████████████████░░
  Determinism      100 / 100   ████████████████████
```

| Rubric              | What it measures                                                                                       |
|---------------------|--------------------------------------------------------------------------------------------------------|
| **Inventory Resolved** | `100 × resolved / total`. Routes mounted via dynamic prefixes drag this down — never silently dropped. |
| **Auth Coverage**      | `100 × guarded / (guarded + open + unknown)`. UNKNOWN counts against — a route we couldn't classify is not a confirmed guard. Intentional-public endpoints (login/signup/refresh/health/...) are excluded — they're declared public-by-design, not a coverage gap. |
| **Open Endpoint Risk** | Starts at 100. Open write methods (POST/PUT/PATCH/DELETE) `-12` each; open GETs `-3` each. Floor 0.    |
| **Spec Drift**         | Starts at 100. Shadow `-5`, stale `-5`, auth-drift `-10` each. `null` (excluded from mean) when no spec found. |
| **Determinism**        | Locked at 100 in v0.1. The byte-equality test is what actually enforces it.                            |

Bands: `STRONG ≥ 85`, `GOOD ≥ 70`, `MIXED ≥ 50`, `WEAK < 50`. Same bands as SecGate / LuxFaber / LuxScope.

The binary gate (exit 1 on open write methods, configurable) is independent of the score. `headlineScore` + `rubrics` are written to `apigate-report.json` for CI dashboards and trend tracking.

---

## TL;DR

```bash
npx @stelnyx/apigate .
```

Inventories every HTTP endpoint, classifies auth posture, diffs against any OpenAPI spec, writes a JSON report + a self-contained HTML report. Exit `0` on clean, `1` on open-write endpoints (default policy). That's the whole product.

---

## What it does today

ApiGate walks source files in a directory and produces:

- **One normalized JSON report** — every endpoint, posture, drift bucket, rubric, headline
- **One self-contained HTML report** — rendered through `@stelnyx/report-theme`; visually + structurally identical to SecGate / LuxScope / LuxFaber reports
- **One exit code** — `1` on open-write endpoints (configurable); blocks CI

ApiGate does not run code. It does not send HTTP requests. It does not require credentials or a running server. Everything happens at parse-time against source files.

---

## Frameworks

| Framework  | Detection                                                                                                                |
|------------|--------------------------------------------------------------------------------------------------------------------------|
| **Express**  | acorn AST for `.js/.mjs/.cjs`; regex fallback for `.ts/.tsx`. Resolves `app.use('/prefix', router)` mounts in same file. |
| **Fastify**  | acorn AST. Handles `fastify.<method>(...)` and `fastify.route({ method, url, preHandler })`.                             |
| **NestJS**   | Decorator extraction over `.ts/.js`. Pairs `@Controller(...)` with method decorators `@Get / @Post / @Put / @Patch / @Delete / @Options / @Head / @All`. Captures class- and method-level guards (`@UseGuards`, `@Auth`, `@Roles`, `@ApiBearerAuth`). |
| **OpenAPI**  | Parses `*.yaml`/`*.yml`/`*.json` with `swagger:` (2.0) or `openapi:` (3.x) root. Honors operation-level `security` and root inheritance. |

Routes that can't be statically resolved (dynamic mount prefixes, computed method names, unparseable files) are emitted as `UNRESOLVED` — never guessed. They count against the **Inventory Resolved** rubric so the report tells you what ApiGate could and couldn't see.

---

## Network access

ApiGate makes **zero** network calls. No telemetry, no account, no phone-home, no advisory database, no spec fetching from URLs. Reports are written to local files only. Code never leaves your machine.

This is unconditional, not a flag. Air-gapped CI works as well as a developer laptop.

---

## What this does NOT prove

The honesty wedge of ApiGate. The report renders this section in every run, never hidden behind a toggle:

1. **Static analysis cannot verify runtime authorization (BOLA / object-level access).** ApiGate only inspects declared auth posture, not the correctness of the auth middleware itself.
2. An endpoint with a declared auth identifier in its middleware chain is classified `GUARDED` — the middleware may still be misconfigured, bypassable, or insecure at runtime.
3. Routes mounted via dynamic strings (computed prefixes, runtime registration, factory functions) are reported as `UNRESOLVED` rather than guessed.
4. ApiGate uses a built-in heuristic pattern list to mark common public-auth paths (login / signup / refresh / health / OAuth callbacks) as **intentional-public**. The heuristic is deterministic and configurable but can be wrong both ways — review the marked endpoints and override `publicAuthPatterns` in `.apigate.config.json` if your project disagrees.
5. ApiGate makes zero network calls. It does not send code, telemetry, or scan artifacts anywhere.

If you need runtime authorization testing (BOLA, IDOR, broken object-level auth), use a dynamic scanner. ApiGate complements DAST tooling; it does not replace it.

### Heuristic posture: public-by-design

Most APIs intentionally expose a handful of unauthenticated endpoints — sign-up, login, refresh, password reset, OAuth callbacks, health probes. Without help, ApiGate's `openWriteMethods: true` default would flag every one of these as FAIL on first run.

ApiGate ships a deterministic, exact-match list of these patterns (see `lib/heuristics.mjs` → `DEFAULT_PUBLIC_AUTH_PATTERNS`). Endpoints matched by the list:

- **Stay in the inventory** — they're never hidden.
- **Keep their declared posture** (OPEN / UNKNOWN) — the heuristic does not lie about what the code says.
- **Are excluded from the default exit-1 gate.**
- **Are excluded from the Auth Coverage denominator.**
- Are tagged `PUBLIC` (in addition to their posture) in the HTML report.

Override the pattern list:

```json
{
  "publicAuthPatterns": [
    { "method": "POST", "path": "/api/v2/auth/login" },
    { "method": "GET",  "path": "/api/v2/auth/google/callback" }
  ]
}
```

`[]` disables the heuristic entirely (every open endpoint counts).
`failOn.intentionalPublic: true` keeps the heuristic for the report but makes those endpoints fail the gate (strict / compliance mode).

---

## Install

### From npm (recommended)

```bash
npm install -g @stelnyx/apigate
```

### One-shot via npx

```bash
npx @stelnyx/apigate .
```

### From source

```bash
git clone https://github.com/Stelnyx/ApiGate.git
cd ApiGate
npm install
chmod +x apigate.js
sudo ln -sf "$(pwd)/apigate.js" /usr/local/bin/apigate
```

---

## Usage

```bash
# Scan current directory
apigate .

# Scan a specific path
apigate /path/to/project

# Write reports to a custom directory
apigate /path/to/project --output-dir /tmp/reports

# Strip absolute paths (auto-on when CI=true)
apigate /path/to/project --strip-paths

# JSON only / HTML only
apigate . --format json
apigate . --format html

# Show parser warnings
apigate . --debug

# PR-aware: did this branch introduce a new unauthenticated route?
apigate . --diff main

# Narrow the visible endpoint table (view-only — does not affect exit code)
apigate . --filter risk=HIGH,posture=OPEN

# Print one endpoint's evidence chain (no files written, exit 0)
apigate . --explain GET /audit/security-events

# Tighten the gate at CI time without editing .apigate.config.json
apigate . --fail-on open-write,unknown,drift,missing-spec,new-open-write

# Byte-stable timestamp for CI (matches SOURCE_DATE_EPOCH convention)
APIGATE_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)" apigate .

# Version / help
apigate --version
apigate --help
```

**`--fail-on` tokens** (comma-separated):

| Token                | Maps to                                  |
|----------------------|------------------------------------------|
| `open-write`         | `failOn.openWriteMethods = true`         |
| `open-read`          | `failOn.openReadMethods  = true`         |
| `unknown`            | `failOn.unknown          = true`         |
| `drift`              | `failOn.drift            = true`         |
| `intentional-public` | `failOn.intentionalPublic = true`        |
| `new-open-write`     | `failOn.newOpenWrite     = true` (needs `--diff`) |
| `missing-spec`       | `requireSpec             = true`         |

Unknown tokens throw — CI typos can never silently relax policy.

**`--filter` grammar:**

```
key=value
key=v1|v2          # OR within a key
key1=v1,key2=v2    # AND across keys
```

Keys: `risk` (HIGH|MED|LOW), `posture` (GUARDED|OPEN|UNKNOWN), `framework`
(express|fastify|nest|openapi), `method` (any HTTP verb), `changed`
(added|removed|changedPosture|changedRisk — requires `--diff`).

**Exit codes**

| Code | Meaning                                                          |
|:----:|------------------------------------------------------------------|
| `0`  | PASS — `gate.reasons` is empty                                   |
| `1`  | FAIL — `gate.reasons[]` lists the exact gate(s) that fired       |
| `2`  | Invalid target or CLI error                                      |

The `gate.reasons[]` array in the JSON report holds the locked enum set
(`drift`, `intentional-public`, `missing-spec`, `open-read`, `open-write`,
`unknown-endpoint`) sorted lexicographically and deduplicated, so CI can
grep failure causes without scraping stdout.

---

## Configuration

Create `.apigate.config.json` in your scan target directory. All fields optional.

```json
{
  "frameworks": {
    "express": true, "fastify": true, "nest": true, "openapi": true
  },
  "auth": {
    "express":  ["requireAuth", "passport.authenticate", "jwt"],
    "fastify":  ["onRequest", "preHandler", "fastify.authenticate"],
    "nest":     ["UseGuards", "AuthGuard", "JwtAuthGuard"]
  },
  "failOn": {
    "openWriteMethods":  true,
    "openReadMethods":   false,
    "unknown":           false,
    "drift":             false,
    "intentionalPublic": false
  },
  "requireSpec": false,
  "strictPublic": false,
  "excludePaths": ["node_modules/**", "dist/**", "**/*.test.*"]
}
```

A fully-commented example config lives at [`.apigate.config.example.json`](.apigate.config.example.json) — copy into your repo as `.apigate.config.json` and edit.

### Field reference

| Field         | Type    | Default                                | Description                                                                 |
|---------------|---------|----------------------------------------|-----------------------------------------------------------------------------|
| `frameworks`  | object  | all `true`                             | Toggle individual parsers                                                  |
| `auth`        | object  | per-framework defaults                 | Identifier names that classify an endpoint as `GUARDED` when present       |
| `failOn`      | object  | `{ openWriteMethods: true, unknown: false, drift: false }` | Exit-code policy                                  |
| `requireSpec` | boolean | `false`                                | Fail when no OpenAPI 2/3 spec is detected                                |
| `strictPublic`| boolean | `false`                                | Disable built-in public-auth patterns unless `publicAuthPatterns` is set  |
| `excludePaths`| array   | `node_modules/`, `dist/`, test dirs    | Globs of files to skip                                                    |

### Precedence

```
CLI flag  >  .apigate.config.json  >  built-in defaults
```

Missing config: silent, defaults apply. Invalid JSON: error logged, defaults apply.

### Auth identifier configuration

ApiGate's classifier reports `GUARDED` when one of the declared auth identifiers appears in the endpoint's middleware/decorator chain. The defaults cover the common framework idioms (`passport.authenticate`, `@UseGuards`, Fastify `preHandler`). For project-specific helpers (e.g., a custom `requireOrg` middleware), extend the list:

```json
{ "auth": { "express": ["requireAuth", "requireOrg", "requireBilling"] } }
```

ApiGate does **not** inspect what these identifiers do at runtime. Their declared presence is the signal — that's the static-analysis honesty contract.

---

## Sample report

A live sample lives at [`samples/realworld-express/`](samples/realworld-express/) — ApiGate's report for the canonical [RealWorld backend](https://github.com/gothinkster/node-express-realworld-example-app) (vendored at a pinned commit under `test/fixtures/realworld-express/`).

```
Headline: 100 / 100  STRONG       rubric v1
  Inventory       100 / 100
  Auth Coverage   100 / 100
  Open Risk       100 / 100
  Spec Drift      n/a / 100
  Determinism     100 / 100

20 endpoints discovered (17 guarded · 3 open · 0 unknown · 3 intentional-public)
STATUS: PASS
```

The 3 open endpoints are sign-up / login / status — all matched by the built-in **intentional-public heuristic** (see [Heuristic posture](#heuristic-posture-public-by-design)), so they're listed in the report but don't trip the default exit-1 gate.

**Strict mode** (`failOn.intentionalPublic: true` in `.apigate.config.json`) treats the heuristic as advisory and fails on those endpoints too — the same run produces STATUS: FAIL and surfaces sign-up / login as findings. Useful for compliance audits where every open route must be justified.

For tighter CI gates:

```json
{
  "failOn": { "unknown": true, "intentionalPublic": true },
  "requireSpec": true,
  "strictPublic": true
}
```

`failOn.unknown` means "cannot prove guarded" fails the run. `requireSpec` prevents a green drift score when no OpenAPI file is present. `strictPublic` disables the built-in public-auth list unless your repo provides `publicAuthPatterns`.

---

## CI / CD

### GitHub Actions — minimal

```yaml
- name: Run ApiGate
  run: npx @stelnyx/apigate .
  # exits 1 on open write endpoints by default — blocks the pipeline
```

### Non-blocking (report only)

```yaml
- name: Run ApiGate
  run: npx @stelnyx/apigate . || true

- name: Upload report
  uses: actions/upload-artifact@v4
  with:
    name: apigate-report
    path: |
      apigate-report.json
      *.html
```

---

## Report output

Each run writes:

- **`apigate-report.json`** — machine-readable, schema below
- **`<repo-name>.html`** — self-contained HTML report (rendered through `@stelnyx/report-theme`)

### JSON schema

```json
{
  "version": "0.2.0",
  "rubricVersion": "v1",
  "riskVersion": "v1",
  "timestamp": "ISO 8601",
  "target": "/absolute/path or repo basename",
  "mode": "static",
  "status": "PASS | FAIL",
  "gate": {
    "status": "PASS | FAIL",
    "reasons": ["drift", "intentional-public", "missing-spec", "new-open-write", "open-read", "open-write", "unknown-endpoint"]
  },
  "headlineScore": 86,
  "rubrics": {
    "inventoryResolved": 86,
    "authCoverage": 67,
    "openEndpointRisk": 85,
    "specDrift": 90,
    "determinism": 100
  },
  "summary": {
    "endpoints": 7, "resolved": 6, "unresolved": 1,
    "guarded": 4, "open": 2, "unknown": 1, "intentionalPublic": 0,
    "risk": { "HIGH": 1, "MED": 2, "LOW": 4 },
    "specEndpoints": 6, "shadow": 1, "stale": 1, "authDrift": 0,
    "unknownReasons": { "mount-prefix-not-static": 1 }
  },
  "endpoints": [
    {
      "method": "GET | POST | PUT | PATCH | DELETE | OPTIONS | HEAD | ALL",
      "path":   "/users/:id",
      "file":   "src/server.js",
      "line":   42,
      "framework": "express | fastify | nest | openapi",
      "resolved": true,
      "posture":  "GUARDED | OPEN | UNKNOWN",
      "intentionalPublic": false,
      "authMarkers": ["requireAuth"],
      "matchedAuthMarker": "requireAuth",
      "risk": "HIGH | MED | LOW",
      "riskReason": "open write method",
      "unresolvedReason": null
    }
  ],
  "drift": {
    "shadow":    [{ "kind": "shadow",  "method": "POST", "path": "/x", "note": "..." }],
    "stale":     [{ "kind": "stale",   "method": "GET",  "path": "/y", "note": "..." }],
    "authDrift": [{ "kind": "authDriftDeclaredOnly", "method": "PUT", "path": "/z", "note": "..." }]
  },
  "refDiff": {
    "baseRef": "main",
    "baseSha": "abc12345...",
    "added":           [{ "method": "POST", "path": "/admin/purge", "posture": "OPEN", "risk": "HIGH" }],
    "removed":         [],
    "changedPosture":  [{ "method": "PUT", "path": "/x", "from": "GUARDED", "to": "OPEN" }],
    "changedRisk":     [{ "method": "POST", "path": "/y", "from": "MED", "to": "HIGH" }]
  },
  "frameworksDetected": ["express", "openapi"],
  "specsDetected": ["openapi.yaml"],
  "parserCapabilities": {
    "express":  { "sameFileMountPrefix": true, "crossFileMountPrefix": false, "dynamicMountPrefix": "UNRESOLVED" },
    "fastify":  { "registerPrefixPropagation": false, "routeOptionsParsed": true },
    "nest":     { "controllerObjectArg": "path field only", "classLevelGuards": true },
    "openapi":  { "missingSecurity": "UNKNOWN (conservative)", "operationSecurityEmptyArray": "OPEN" }
  },
  "riskTier": { "version": "v1", "sensitivePathTokens": 9, "buckets": ["HIGH","MED","LOW"], "overrideHook": "config.severityOverrides" },
  "filter": "risk=HIGH,posture=OPEN",
  "warnings": [],
  "limitations": ["..."]
}
```

### New keys in v0.2.0

| Key                          | Why                                                                                          |
|------------------------------|----------------------------------------------------------------------------------------------|
| `refDiff{}`                  | PR-aware diff vs a git ref. Surfaces added/removed endpoints + posture/risk regressions.     |
| `endpoints[].risk` / `riskReason` | Per-endpoint HIGH/MED/LOW tier. Triage aid. Frozen v1 ladder; `severityOverrides` config to pin. |
| `summary.risk{}`             | HIGH/MED/LOW counts. New score-hero sub-line and KPI tiles surface these.                    |
| `riskTier{}` + `riskVersion` | Rubric version of the risk ladder that produced the tiers.                                   |
| `filter`                     | The filter expression in effect (view-only — `summary` always reflects the full scan).       |

### Posture tiers

| Posture     | Meaning                                                                                  |
|-------------|------------------------------------------------------------------------------------------|
| **GUARDED** | At least one declared auth identifier present in the endpoint's middleware/decorator chain |
| **OPEN**    | Endpoint resolved, no auth identifier present                                            |
| **UNKNOWN** | Endpoint itself is unresolved, OR (specs) no security block present                      |

### `matchedAuthMarker` in practice — what reviewability looks like

`matchedAuthMarker` (added in v0.1.2) is the lever for catching a false GUARDED without changing the trust model. The classifier still flags an endpoint GUARDED when any declared identifier appears in its decorator chain — but the report now shows you exactly *which* identifier triggered the match, so an unusual one stands out.

Real example from dogfooding v0.1.2 against a 423-endpoint production NestJS app:

```
matchedAuthMarker distribution (GUARDED endpoints):
  313  ApiBearerAuth   ← Swagger documentation decorator
   12  UseGuards       ← actual runtime guard
    2  Roles
```

`@ApiBearerAuth()` is a Swagger documentation decorator, **not** a runtime guard. 313 of the 327 GUARDED endpoints matched on it. Most are still protected by a global `APP_GUARD` registered in `app.module.ts` (invisible to static analysis — see `parserCapabilities.nest`), but 39 had no other guard identifier in their decorator chain at all. Without `matchedAuthMarker` those would have been silent in the report. With it, the reviewer has a 30-second triage path.

If your codebase wants to drop the false signal entirely, remove `ApiBearerAuth` from `auth.nest` in `.apigate.config.json`. ApiGate's defaults are intentionally permissive (the cost of missing a real guard outweighs the cost of a false GUARDED that `matchedAuthMarker` makes visible).

---

## Design parity

ApiGate is visually + structurally indistinguishable from SecGate, LuxScope, and LuxFaber. The HTML report is rendered through `@stelnyx/report-theme@^0.1.0` — the same version, same imports, same shell envelope, no fork, no local restyle. See [DESIGN_PARITY.md](DESIGN_PARITY.md) for the contract.

If a missing theme component blocks ApiGate, the resolution is an upstream PR to `report-theme`, not a local patch. That's how the four-tool shelf stays one product.

---

## Documentation

| Doc                                                    | What's in it                                                                   |
|--------------------------------------------------------|--------------------------------------------------------------------------------|
| [`CHANGELOG.md`](CHANGELOG.md)                         | Version history — Added / Changed / Fixed per release                          |
| [`OPEN-CORE.md`](OPEN-CORE.md)                         | OSS core boundary and paid extension roadmap                                   |
| [`DESIGN_PARITY.md`](DESIGN_PARITY.md)                 | The report-theme consumption contract                                          |
| [`SECURITY.md`](SECURITY.md)                           | Vulnerability reporting, SLA, coordinated disclosure                           |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                   | Dev setup, branch + commit conventions, PR checklist                           |

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Report vulnerabilities privately per [`SECURITY.md`](SECURITY.md) — **do not open public issues for security reports**.

---

## License

[MIT](LICENSE) — © Stelnyx
