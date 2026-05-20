import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { normalizePath, normalizeMethod } from "./utils.mjs";
import { buildInventory } from "./inventory.mjs";
import { classifyAll } from "./auth.mjs";
import { annotateIntentionalPublic, DEFAULT_PUBLIC_AUTH_PATTERNS } from "./heuristics.mjs";
import { annotateRisk } from "./risk.mjs";

/**
 * Ref-diff — compare the current scan to the inventory at a git ref.
 *
 * Materialize the base ref via `git worktree add --detach`. Worktrees are
 * cheap (no clone, no objects copy), preserve the repo's `.git` state, and
 * give us a real filesystem path for `buildInventory` to walk.
 *
 * Determinism:
 *   - Resolve `<ref>` to a full SHA up front and emit `baseSha` in the
 *     report. Two runs against the same ref produce byte-equal diffs even
 *     if the branch tip moves between invocations.
 *   - Worktree dir name uses short_sha so concurrent CI runs on different
 *     refs don't collide.
 *   - Stale worktrees from prior crashes are pruned at start.
 *   - Cleanup runs in a `finally` so partial failures don't leak state.
 */

const SHORT_SHA_LEN = 8;
const WORKTREE_PREFIX = "apigate-diff-";

function git(args, cwd) {
  // Force-quiet, machine-readable output. Surface stderr on failure.
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function resolveSha(ref, cwd) {
  return git(["rev-parse", ref], cwd);
}

export function pruneStaleWorktrees(cwd) {
  try { git(["worktree", "prune"], cwd); } catch { /* nothing to prune */ }
}

export function addWorktree(sha, cwd) {
  const dir = path.join(os.tmpdir(), `${WORKTREE_PREFIX}${sha.slice(0, SHORT_SHA_LEN)}`);
  if (fs.existsSync(dir)) {
    // Stale path — could be a partial worktree from a crash. Try to clean
    // it via git, fall back to fs.rm if git doesn't know it.
    try { git(["worktree", "remove", "--force", dir], cwd); } catch { /* ignore */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  git(["worktree", "add", "--detach", dir, sha], cwd);
  return dir;
}

export function removeWorktree(dir, cwd) {
  try { git(["worktree", "remove", "--force", dir], cwd); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Build the *base* endpoint list — runs the same inventory + classify +
 * heuristic + risk pipeline against the worktree directory. The resulting
 * endpoints are key-comparable to the current endpoint list.
 */
export function buildBaseEndpoints(worktreeDir, config) {
  const inv = buildInventory(worktreeDir, config);
  const patterns = config.publicAuthPatterns ?? (config.strictPublic ? [] : DEFAULT_PUBLIC_AUTH_PATTERNS);
  const classified = annotateIntentionalPublic(classifyAll(inv.code, config), patterns);
  const overrides = Array.isArray(config.severityOverrides) ? config.severityOverrides : [];
  return annotateRisk(classified, overrides);
}

function endpointKey(e) {
  return `${normalizeMethod(e.method)} ${normalizePath(e.path)}`;
}

function indexBy(endpoints) {
  const map = new Map();
  for (const e of endpoints) {
    if (e.resolved === false) continue;
    const k = endpointKey(e);
    if (!map.has(k)) map.set(k, e);
  }
  return map;
}

function sortDiffItems(arr) {
  return [...arr].sort((a, b) => {
    if (a.method !== b.method) return a.method < b.method ? -1 : 1;
    if (a.path !== b.path) return (a.path || "") < (b.path || "") ? -1 : 1;
    return 0;
  });
}

/**
 * Pure diff — compare two endpoint arrays (with risk already annotated).
 * Exported so tests can exercise the diff logic without touching git.
 */
export function diffEndpoints(currentEndpoints, baseEndpoints) {
  const curr = indexBy(currentEndpoints);
  const base = indexBy(baseEndpoints);
  const added = [];
  const removed = [];
  const changedPosture = [];
  const changedRisk = [];

  for (const [key, e] of curr.entries()) {
    if (!base.has(key)) {
      added.push({
        method: e.method,
        path: e.path,
        posture: e.posture,
        risk: e.risk ?? null
      });
      continue;
    }
    const b = base.get(key);
    if (b.posture !== e.posture) {
      changedPosture.push({
        method: e.method,
        path: e.path,
        from: b.posture,
        to: e.posture
      });
    }
    if (b.risk && e.risk && b.risk !== e.risk) {
      changedRisk.push({
        method: e.method,
        path: e.path,
        from: b.risk,
        to: e.risk
      });
    }
  }
  for (const [key, b] of base.entries()) {
    if (!curr.has(key)) {
      removed.push({
        method: b.method,
        path: b.path,
        posture: b.posture
      });
    }
  }
  return {
    added: sortDiffItems(added),
    removed: sortDiffItems(removed),
    changedPosture: sortDiffItems(changedPosture),
    changedRisk: sortDiffItems(changedRisk)
  };
}

/**
 * End-to-end ref diff. Spins a worktree, runs the inventory pipeline
 * against it, diffs the result, cleans up. Returns the refDiff payload
 * shaped exactly as it appears in the JSON report.
 */
export function buildRefDiff({ ref, repoRoot, currentEndpoints, config }) {
  const baseSha = resolveSha(ref, repoRoot);
  pruneStaleWorktrees(repoRoot);
  let worktreeDir;
  try {
    worktreeDir = addWorktree(baseSha, repoRoot);
    const baseEndpoints = buildBaseEndpoints(worktreeDir, config);
    const diff = diffEndpoints(currentEndpoints, baseEndpoints);
    return {
      baseRef: ref,
      baseSha,
      ...diff
    };
  } finally {
    if (worktreeDir) removeWorktree(worktreeDir, repoRoot);
  }
}
