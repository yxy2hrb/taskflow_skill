const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { loadSkillEnv } = require('../../../scripts/paths');
const { resolveTextModel } = require('../../../scripts/llm_config');

const ROOT = process.cwd();
const VALID_STATUSES = new Set([
  'idle',
  'generating',
  'awaiting_confirm',
  'confirmed',
  'completed',
  'failed',
]);

function stampNow() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function relativeToRoot(value) {
  const relative = path.relative(ROOT, value);
  return relative && !relative.startsWith('..') ? relative : value;
}

function resolveSourceFile(sourceDir, explicitPath, candidates) {
  if (explicitPath) {
    const resolved = resolveFromRoot(explicitPath);
    if (!fs.existsSync(resolved)) throw new Error(`Missing input file: ${resolved}`);
    return resolved;
  }
  const found = candidates.map((name) => path.join(sourceDir, name)).find((file) => fs.existsSync(file));
  if (!found) throw new Error(`Missing ${candidates.join(' or ')} in ${sourceDir}`);
  return found;
}

function sessionPaths(sessionDir) {
  const resolved = resolveFromRoot(sessionDir);
  return {
    sessionDir: resolved,
    sessionFile: path.join(resolved, 'session.json'),
    stagesDir: path.join(resolved, 'stages'),
    logsDir: path.join(resolved, 'logs'),
    validationDir: path.join(resolved, 'validation'),
  };
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(temp, file);
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

async function createSession({
  sessionDir,
  sourceDir,
  model,
  mode = 'interactive',
  inputPath = '',
  pageDslPath = '',
  stamp = stampNow(),
}) {
  loadSkillEnv();
  const resolvedModel = resolveTextModel(model || '');
  const source = resolveFromRoot(sourceDir);
  if (!fs.existsSync(source)) throw new Error(`Missing source directory: ${source}`);
  const brief = resolveSourceFile(source, inputPath, ['input.txt', '1.md']);
  const pageDsl = resolveSourceFile(source, pageDslPath, ['spec.json', 'wps_doc_0.dsl.json', 'page_dsl.json']);
  const defaultSessionDir = path.join(source, '.run_skill', stamp, 'blueprint');
  const paths = sessionPaths(sessionDir || defaultSessionDir);
  await Promise.all([
    fsp.mkdir(paths.stagesDir, { recursive: true }),
    fsp.mkdir(paths.logsDir, { recursive: true }),
    fsp.mkdir(paths.validationDir, { recursive: true }),
  ]);
  const session = {
    stamp,
    model: resolvedModel,
    source_dir: relativeToRoot(source),
    mode,
    current_phase: 1,
    status: 'idle',
    completed_phases: [],
    paths: {
      stages_dir: relativeToRoot(paths.stagesDir),
      brief: relativeToRoot(brief),
      page_dsl: relativeToRoot(pageDsl),
    },
  };
  await writeJson(paths.sessionFile, session);
  return { session, ...paths };
}

async function loadSession(sessionDir) {
  const paths = sessionPaths(sessionDir);
  if (!fs.existsSync(paths.sessionFile)) throw new Error(`Missing session.json: ${paths.sessionFile}`);
  const session = await readJson(paths.sessionFile);
  if (!VALID_STATUSES.has(session.status)) throw new Error(`Invalid session status: ${session.status}`);
  return { session, ...paths };
}

async function saveSession(sessionDir, session) {
  if (!VALID_STATUSES.has(session.status)) throw new Error(`Invalid session status: ${session.status}`);
  const paths = sessionPaths(sessionDir);
  await writeJson(paths.sessionFile, session);
  return session;
}

async function patchSession(sessionDir, patch) {
  const loaded = await loadSession(sessionDir);
  const next = {
    ...loaded.session,
    ...(typeof patch === 'function' ? patch(loaded.session) : patch),
  };
  await saveSession(sessionDir, next);
  return next;
}

function stageFile(paths, name) {
  return path.join(paths.stagesDir, name);
}

function logFile(paths, name) {
  return path.join(paths.logsDir, name);
}

function validationFile(paths, name) {
  return path.join(paths.validationDir, name);
}

function assertCanGenerate(session, phase) {
  if (phase < 1 || phase > 4) throw new Error(`Invalid phase: ${phase}`);
  if (session.status === 'completed') throw new Error('Blueprint session is already completed.');
  if (session.status === 'awaiting_confirm') {
    throw new Error(`Phase ${session.current_phase} is awaiting confirmation.`);
  }
  if (session.current_phase !== phase) {
    throw new Error(`Session expects phase ${session.current_phase}, received phase ${phase}.`);
  }
  if (phase > 1 && !session.completed_phases.includes(phase - 1)) {
    throw new Error(`Phase ${phase - 1} must be confirmed before phase ${phase}.`);
  }
}

function assertCanConfirm(session, phase) {
  if (session.status !== 'awaiting_confirm') {
    throw new Error(`Session is not awaiting confirmation; current status is ${session.status}.`);
  }
  if (session.current_phase !== phase) {
    throw new Error(`Session is awaiting phase ${session.current_phase}, received phase ${phase}.`);
  }
}

module.exports = {
  ROOT,
  assertCanConfirm,
  assertCanGenerate,
  createSession,
  loadSession,
  logFile,
  patchSession,
  readJson,
  relativeToRoot,
  resolveFromRoot,
  saveSession,
  sessionPaths,
  stageFile,
  stampNow,
  validationFile,
  writeJson,
};
