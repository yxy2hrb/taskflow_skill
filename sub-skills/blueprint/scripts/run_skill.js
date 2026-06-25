#!/usr/bin/env node
const { loadSkillEnv } = require('../../../scripts/paths');
const { resolveTextModel } = require('../../../scripts/llm_config');
const {
  createSession,
  loadSession,
  stageFile,
} = require('./session');
const {
  buildPhaseDraft,
  confirmPhase,
  generatePhase,
  latestStagePayload,
  revisePhaseDraft,
  ValidationError,
} = require('./phase_runners');
const { renderConfirmedView, renderView } = require('./render_view');
const { runAuto } = require('./legacy_auto');
const { promptForFeedback, readFeedbackFile } = require('./numbered_interaction');

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
  const args = command ? argv.slice(1) : argv;
  const opts = { command, flags: {}, dirs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dirs') {
      index += 1;
      while (index < args.length && !args[index].startsWith('--')) {
        opts.dirs.push(args[index]);
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      const next = args[index + 1];
      opts.flags[key] = next && !next.startsWith('--') ? next : true;
      if (opts.flags[key] !== true) index += 1;
    }
  }
  return opts;
}

function usage() {
  return [
    'Usage:',
    '  node run_skill.js init --dirs <caseDir> [--session-dir <dir>] [--model <name>]',
    '  node run_skill.js generate --session-dir <dir> --phase 1|2|3|4',
    '  node run_skill.js confirm --session-dir <dir> --phase 1|2|3|4',
    '  node run_skill.js confirm --session-dir <dir> --phase 1|2|3|4 --input feedback.json|feedback.txt',
    '  node run_skill.js resume --session-dir <dir>',
    '  node run_skill.js status --session-dir <dir>',
    '  node run_skill.js auto --dirs <caseDir...> [--session-dir <dir>] [--model <name>]',
  ].join('\n');
}

function requireSessionDir(flags) {
  if (!flags.sessionDir) throw new Error('--session-dir is required');
  return flags.sessionDir;
}

function phaseFromFlags(flags) {
  const phase = Number(flags.phase);
  if (![1, 2, 3, 4].includes(phase)) throw new Error('--phase must be 1, 2, 3, or 4');
  return phase;
}

async function printStatus(sessionDir) {
  const loaded = await loadSession(sessionDir);
  const payload = latestStagePayload(loaded, loaded.session);
  const status = {
    session: loaded.session,
    session_dir: loaded.sessionDir,
    awaiting_view: payload ? path.join(loaded.stagesDir, payload.action === 'preview' ? 'phase4_preview.json' : `phase${payload.phase}_ask.json`) : null,
    final_output: loaded.session.status === 'completed' ? stageFile(loaded, 'blueprint_builder_input.json') : null,
  };
  console.log(JSON.stringify(status, null, 2));
  if (payload) {
    console.log('\n--- view ---\n');
    console.log(renderView(payload));
  }
}

async function main() {
  loadSkillEnv();
  const opts = parseArgs(process.argv.slice(2));
  const { command, flags, dirs } = opts;
  if (!command || flags.help) {
    console.log(usage());
    return;
  }
  if (flags.skill) {
    throw new Error('--skill is deprecated. Use init/generate/confirm/resume/status/auto with --phase instead.');
  }

  if (command === 'init') {
    if (dirs.length !== 1) throw new Error('init requires exactly one --dirs <caseDir>');
    const created = await createSession({
      sourceDir: dirs[0],
      sessionDir: flags.sessionDir || '',
      model: resolveTextModel(flags.model || ''),
      mode: flags.mode || 'interactive',
      inputPath: flags.input || '',
      pageDslPath: flags.pageDsl || '',
    });
    console.log(JSON.stringify({
      status: created.session.status,
      current_phase: created.session.current_phase,
      session_dir: created.sessionDir,
      next_action: `generate --session-dir ${created.sessionDir} --phase 1`,
    }, null, 2));
    return;
  }

  if (command === 'generate') {
    const sessionDir = requireSessionDir(flags);
    const phase = phaseFromFlags(flags);
    const payload = await generatePhase(sessionDir, phase);
    console.log(JSON.stringify({
      status: 'awaiting_confirm',
      phase,
      output: path.join(sessionDir, 'stages', phase === 4 ? 'phase4_preview.json' : `phase${phase}_ask.json`),
    }, null, 2));
    if (phase !== 3) {
      console.log('\n--- view ---\n');
      console.log(renderView(payload));
    } else {
      console.log('\nPhase 3 实现方案已生成，请执行 confirm 查看完整方案并输入修改意见。');
    }
    return;
  }

  if (command === 'confirm') {
    const sessionDir = requireSessionDir(flags);
    const phase = phaseFromFlags(flags);
    const loaded = await loadSession(sessionDir);
    const payload = latestStagePayload(loaded, loaded.session);
    if (!payload || payload.phase !== phase) {
      throw new Error(`Missing pending Phase ${phase} ask/preview.`);
    }
    if (!flags.noView && phase !== 3) {
      console.log(renderView(payload));
      console.log('');
    }
    let feedback = flags.input
      ? await readFeedbackFile(flags.input, payload)
      : await promptForFeedback(payload, {
        createDraft: (selectionFeedback) => buildPhaseDraft(
          sessionDir,
          phase,
          selectionFeedback,
          { allowDefaults: false },
        ),
        reviseDraft: (draft, modification) => revisePhaseDraft(
          sessionDir,
          phase,
          draft,
          modification,
        ),
        renderDraft: (draft) => renderConfirmedView(draft, { phase3Ask: payload }),
      });
    if (feedback?.__model_revision_script) {
      let draft = await buildPhaseDraft(
        sessionDir,
        phase,
        feedback.selection_feedback,
        { allowDefaults: false },
      );
      if (phase !== 3) console.log('\n--- 根据所选编号生成的完整内容 ---\n');
      console.log(renderConfirmedView(draft, { phase3Ask: payload }));
      for (const modification of feedback.modification_feedback || []) {
        draft = await revisePhaseDraft(sessionDir, phase, draft, modification);
        console.log(phase === 3
          ? '\n--- 修改后的 Phase 3 实现方案 ---\n'
          : '\n--- 模型修改后的完整内容 ---\n');
        console.log(renderConfirmedView(draft, { phase3Ask: payload }));
      }
      feedback = draft;
    }
    const output = await confirmPhase(sessionDir, phase, feedback, { allowDefaults: false });
    console.log(JSON.stringify({
      status: phase === 4 ? 'completed' : 'idle',
      phase,
      output: path.join(sessionDir, 'stages', phase === 4 ? 'blueprint_builder_input.json' : `phase${phase}_${phase === 3 ? 'confirmed_by_id' : 'confirmed'}.json`),
      next_action: phase < 4 ? `generate --session-dir ${sessionDir} --phase ${phase + 1}` : null,
    }, null, 2));
    return;
  }

  if (command === 'resume') {
    const sessionDir = requireSessionDir(flags);
    const loaded = await loadSession(sessionDir);
    if (loaded.session.status === 'idle') {
      const payload = await generatePhase(sessionDir, loaded.session.current_phase);
      console.log(JSON.stringify({
        status: 'awaiting_confirm',
        phase: loaded.session.current_phase,
      }, null, 2));
      if (loaded.session.current_phase !== 3) {
        console.log('\n--- view ---\n');
        console.log(renderView(payload));
      } else {
        console.log('\nPhase 3 实现方案已生成，请执行 confirm 查看完整方案并输入修改意见。');
      }
      return;
    }
    if (loaded.session.status === 'awaiting_confirm') {
      await printStatus(sessionDir);
      return;
    }
    if (loaded.session.status === 'completed') {
      console.log(JSON.stringify({
        status: 'completed',
        output: stageFile(loaded, 'blueprint_builder_input.json'),
      }, null, 2));
      return;
    }
    throw new Error(`Cannot resume session in status ${loaded.session.status}`);
  }

  if (command === 'status') {
    await printStatus(requireSessionDir(flags));
    return;
  }

  if (command === 'auto') {
    const results = await runAuto({
      dirs,
      sessionDir: flags.sessionDir || '',
      model: resolveTextModel(flags.model || ''),
      inputPath: flags.input || '',
      pageDslPath: flags.pageDsl || '',
    });
    console.log(JSON.stringify({ mode: 'auto', results }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

main().catch((error) => {
  if (error instanceof ValidationError || error.exitCode === 2) {
    console.error('[blueprint] validation failed:', error.message);
    if (error.report) console.error(JSON.stringify(error.report, null, 2));
    process.exit(2);
  }
  if (error.code === 'ENOENT' && error.path) {
    console.error(`[blueprint] missing file: ${error.path}`);
  } else {
    console.error('[blueprint] failed:', error.stack || error.message);
  }
  process.exit(1);
});
