"use strict";

const fs = require("fs");
const path = require("path");

/** Absolute path to `taskflow-llm-pagegen/` (this file lives in `<skill>/scripts/`). */
const SKILL_ROOT = path.resolve(__dirname, "..");

function exists(file) {
  return fs.existsSync(file);
}

function loadDotEnv(file) {
  if (!exists(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] == null) process.env[match[1]] = value;
  }
}

/** Load API keys from `<skill>/.env` only (no parent-directory fallback). */
function loadSkillEnv() {
  loadDotEnv(path.join(SKILL_ROOT, ".env"));
}

function findNodeModulesDirs() {
  const skillNm = path.join(SKILL_ROOT, "node_modules");
  return exists(skillNm) ? [skillNm] : [];
}

/** Prepend discovered node_modules dirs to NODE_PATH (playwright, react, …). */
function configureNodePath() {
  const entries = String(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of findNodeModulesDirs()) {
    if (!entries.includes(dir)) entries.unshift(dir);
  }
  if (entries.length) process.env.NODE_PATH = entries.join(path.delimiter);
}

/**
 * Resolve a CLI path argument.
 * - Absolute paths are returned as-is.
 * - Relative paths resolve against `baseDir` (default: process.cwd()).
 */
function resolveArgPath(arg, baseDir) {
  const raw = String(arg || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(raw)) return path.normalize(raw);
  return path.resolve(baseDir || process.cwd(), raw);
}

function relFromCwd(file) {
  if (!file) return "";
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

module.exports = {
  SKILL_ROOT,
  exists,
  loadDotEnv,
  loadSkillEnv,
  configureNodePath,
  findNodeModulesDirs,
  resolveArgPath,
  relFromCwd,
};
