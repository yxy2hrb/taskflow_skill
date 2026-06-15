const fs = require('fs');
const path = require('path');
const { createSession, loadSession, resolveFromRoot } = require('./session');
const { confirmPhase, generatePhase } = require('./phase_runners');

async function runAuto({ dirs, sessionDir, model, inputPath, pageDslPath }) {
  if (!dirs.length) throw new Error('auto requires --dirs <caseDir>');
  const results = [];
  for (const dir of dirs) {
    const requestedSessionDir = dirs.length === 1 ? sessionDir : '';
    const resolvedSessionDir = requestedSessionDir ? resolveFromRoot(requestedSessionDir) : '';
    const existingSession = resolvedSessionDir && fs.existsSync(path.join(resolvedSessionDir, 'session.json'));
    const created = existingSession
      ? await loadSession(resolvedSessionDir)
      : await createSession({
        sourceDir: dir,
        sessionDir: requestedSessionDir,
        model,
        mode: 'auto',
        inputPath,
        pageDslPath,
      });
    const currentSessionDir = created.sessionDir;
    while (true) {
      const loaded = await loadSession(currentSessionDir);
      const { session } = loaded;
      if (session.status === 'completed') break;
      if (session.status === 'idle') {
        await generatePhase(currentSessionDir, session.current_phase);
        continue;
      }
      if (session.status === 'awaiting_confirm') {
        await confirmPhase(
          currentSessionDir,
          session.current_phase,
          session.current_phase === 4 ? { confirm: true } : {},
          { allowDefaults: true },
        );
        continue;
      }
      throw new Error(`Cannot resume auto blueprint from status ${session.status}`);
    }
    const finished = await loadSession(currentSessionDir);
    results.push({
      source_dir: dir,
      session_dir: currentSessionDir,
      status: finished.session.status,
      output: `${currentSessionDir}/stages/blueprint_builder_input.json`,
    });
  }
  return results;
}

module.exports = { runAuto };
