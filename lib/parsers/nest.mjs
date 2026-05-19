import fs from "fs";
import { walkFiles, relPath } from "../utils.mjs";

const EXTS = [".ts", ".js", ".mjs", ".tsx"];

const METHOD_DECORATORS = [
  "Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All"
];

/**
 * Parse NestJS routes statically.
 *
 * NestJS sources are usually TypeScript with decorators; full TS AST parsing
 * is heavy. v0.1 uses a focused regex extractor that handles the canonical
 * NestJS layout:
 *
 *   @Controller('users')
 *   @UseGuards(JwtAuthGuard)
 *   export class UsersController {
 *     @Get(':id')
 *     @ApiBearerAuth()
 *     async findOne(@Param('id') id: string) { ... }
 *   }
 *
 * Strategy:
 *   1. Locate every `@Controller(...)` decorator + the class declaration it
 *      attaches to. Capture class-level decorators (UseGuards, Auth, etc.).
 *   2. For each method inside that class, scan upward from the method header
 *      to collect contiguous decorators (HTTP method + auth markers).
 *   3. Combine class-level + method-level markers as the endpoint's
 *      authMarkers list.
 *
 * Unresolvable cases (controller path is a variable, dynamic decorator
 * argument, missing class body): record with resolved: false.
 */
export function parseNest(targetDir, excludePaths = []) {
  const files = walkFiles(targetDir, EXTS, excludePaths);
  const endpoints = [];
  const warnings = [];

  for (const file of files) {
    let src;
    try {
      src = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    if (!/@Controller\s*\(/.test(src)) continue;

    const rel = relPath(targetDir, file);
    const controllers = findControllers(src);
    for (const ctrl of controllers) {
      const ctrlPath = ctrl.path;
      const ctrlMarkers = ctrl.classMarkers;
      const body = ctrl.body;
      const methods = findMethodDecorators(body, src, ctrl.bodyStart);

      for (const m of methods) {
        const subPath = m.path;
        const fullPath = combine(ctrlPath, subPath);
        const resolved = ctrl.resolved && m.resolved;
        endpoints.push({
          method: m.verb.toUpperCase(),
          path: resolved ? fullPath : null,
          file: rel,
          line: m.line,
          framework: "nest",
          resolved,
          authMarkers: dedupSorted([...ctrlMarkers, ...m.markers]),
          unresolvedReason: resolved
            ? null
            : !ctrl.resolved
              ? "controller-path-not-static-string"
              : "method-path-not-static-string"
        });
      }
    }
  }

  return { endpoints, warnings };
}

function findControllers(src) {
  const out = [];
  const ctrlRe = /@Controller\s*\(([\s\S]*?)\)/g;
  let m;
  while ((m = ctrlRe.exec(src)) !== null) {
    const argRaw = m[1].trim();
    const { className, bodyStart, bodyEnd, headerStart } = locateClassAfter(src, m.index + m[0].length);
    if (className === null) continue;
    // Collect every decorator immediately preceding the class declaration
    // (above and between @Controller and the class keyword). Drop @Controller
    // itself from the marker list since it's the framework anchor, not auth.
    const classMarkers = collectAdjacentDecorators(src, headerStart).filter(n => n !== "Controller");
    const body = src.slice(bodyStart, bodyEnd);

    let pathLit;
    let resolved;
    if (argRaw === "") {
      pathLit = "";
      resolved = true;
    } else {
      pathLit = parseStringArg(argRaw);
      resolved = pathLit !== null;
    }

    out.push({
      path: resolved ? pathLit : null,
      classMarkers,
      bodyStart,
      bodyEnd,
      body,
      resolved
    });
  }
  return out;
}

function collectAdjacentDecorators(src, controllerIdx) {
  const before = src.slice(0, controllerIdx);
  const lines = before.split(/\n/);
  const markers = [];
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === "") continue;
    if (line.startsWith("//") || line.startsWith("*")) continue;
    if (!line.startsWith("@")) break;
    const name = line.match(/^@([A-Za-z_$][\w$]*)/);
    if (name) markers.push(name[1]);
  }
  return markers;
}

function locateClassAfter(src, fromIdx) {
  const rest = src.slice(fromIdx);
  const classMatch = rest.match(/(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)[^{]*\{/);
  if (!classMatch) return { className: null, bodyStart: -1, bodyEnd: -1, headerStart: -1 };
  const headerStart = fromIdx + classMatch.index;
  const braceIdx = src.indexOf("{", headerStart);
  if (braceIdx === -1) return { className: null, bodyStart: -1, bodyEnd: -1, headerStart: -1 };
  let depth = 1;
  let i = braceIdx + 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  return { className: classMatch[1], bodyStart: braceIdx + 1, bodyEnd: i - 1, headerStart };
}

function findMethodDecorators(body, fullSrc, bodyStart) {
  const out = [];
  for (const verb of METHOD_DECORATORS) {
    const re = new RegExp(`@${verb}\\s*\\(([\\s\\S]*?)\\)`, "g");
    let m;
    while ((m = re.exec(body)) !== null) {
      const absoluteIdx = bodyStart + m.index;
      const lineNo = fullSrc.slice(0, absoluteIdx).split(/\n/).length;
      const argRaw = m[1].trim();
      let pathLit;
      let resolved;
      if (argRaw === "") {
        pathLit = "";
        resolved = true;
      } else {
        pathLit = parseStringArg(argRaw);
        resolved = pathLit !== null;
      }
      const markers = collectAdjacentDecorators(fullSrc, absoluteIdx);
      out.push({
        verb,
        path: resolved ? pathLit : null,
        line: lineNo,
        resolved,
        markers
      });
    }
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

function parseStringArg(raw) {
  const s = raw.trim().replace(/,\s*$/, "");
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  if (s.startsWith("`") && s.endsWith("`") && !s.includes("${")) {
    return s.slice(1, -1);
  }
  // Object-literal form: @Controller({ path: 'users', version: '1' })
  // We extract `path` as the canonical route prefix and ignore version (the
  // version segment is mounted by NestJS via VersioningOptions at bootstrap;
  // it isn't statically resolvable from the controller alone).
  if (s.startsWith("{") && s.endsWith("}")) {
    const m = s.match(/\bpath\s*:\s*(['"`])([^'"`]+)\1/);
    if (m) return m[2];
  }
  // Array form: @Controller(['users', 'people']) — pick first; the others
  // become legitimate aliases but v0.1 reports one canonical path.
  if (s.startsWith("[") && s.endsWith("]")) {
    const m = s.match(/(['"`])([^'"`]+)\1/);
    if (m) return m[2];
  }
  return null;
}

function combine(prefix, sub) {
  const a = (prefix || "").replace(/\/$/, "");
  const b = (sub || "").replace(/^\//, "");
  if (!a && !b) return "/";
  if (!a) return "/" + b;
  if (!b) return a.startsWith("/") ? a : "/" + a;
  const head = a.startsWith("/") ? a : "/" + a;
  return head + "/" + b;
}

function dedupSorted(arr) {
  return [...new Set(arr)].sort();
}
