const fs = require('fs');
const path = require('path');
const { callQwen, clip, extractJSON, readTextIfExists } = require('./llm');
const {
  assertCanConfirm,
  assertCanGenerate,
  loadSession,
  logFile,
  patchSession,
  readJson,
  relativeToRoot,
  resolveFromRoot,
  stageFile,
  validationFile,
  writeJson,
} = require('./session');
const {
  applyPhase2Selection,
  applyPhase3Selection,
  buildPhase4Preview,
  finalizePhase4,
  synthesizePhase1Confirmed,
} = require('./compose_confirmed');
const { normalizeOrderedStates, statesToMap } = require('./state_sequence');
const { validatePhase } = require('./validate_phase');

const SKILL_ROOT = path.resolve(__dirname, '..');

class ValidationError extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'ValidationError';
    this.report = report;
    this.exitCode = 2;
  }
}

function skillDoc(relative) {
  return readTextIfExists(path.join(SKILL_ROOT, relative));
}

function readSessionText(session, key) {
  return readTextIfExists(resolveFromRoot(session.paths[key])).trim();
}

function readPageDsl(session) {
  return readTextIfExists(resolveFromRoot(session.paths.page_dsl)).trim();
}

function normalizePhase1Ask(parsed) {
  return {
    action: 'ask',
    phase: 1,
    questionText: parsed.questionText || '请从下面四个维度各选一项，我会合成完整 User Story。',
    multiSelect: true,
    allowCustom: true,
    note: parsed.note || '四个维度各选一项；也可在补充栏直接写覆盖内容。',
    options: Array.isArray(parsed.options) ? parsed.options : [],
  };
}

function normalizePhase2Ask(parsed) {
  return {
    action: 'ask',
    phase: 2,
    questionText: parsed.questionText || '以下是 happy-path 状态清单，请确认保留哪些、是否需要补充。',
    multiSelect: true,
    allowCustom: true,
    note: parsed.note || '默认全部保留；取消不需要的状态；补充栏可写新状态。',
    options: (Array.isArray(parsed.options) ? parsed.options : []).map((option, index) => ({
      id: option.id || `state_${index + 1}`,
      label: option.label || option.state_name || `状态 ${index + 1}`,
      description: option.description || '',
      basis: option.basis || option.rationale || '',
      default: option.default !== false,
    })),
  };
}

function normalizePhase3Ask(parsed) {
  return {
    action: 'ask',
    phase: 3,
    questionText: parsed.questionText || '以下是完整 UI 实现方案，请直接确认或提出修改意见。',
    multiSelect: false,
    allowCustom: true,
    note: parsed.note || '无需选择编号；修改意见会作用于完整实现方案。',
    options: (Array.isArray(parsed.options) ? parsed.options : []).map((option) => ({
      id: option.id || '',
      group: option.group || '',
      implementation_plan: option.implementation_plan || option.implementationPlan || option.plan || option.label || '',
      basis: option.basis || option.rationale || '',
    })),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function phaseContext(paths, phase) {
  if (phase < 3) return {};
  const phase2 = await readJson(stageFile(paths, 'phase2_confirmed.json'));
  return { states: phase2.states };
}

async function composePhaseOutput(paths, session, phase, feedback = {}, options = {}) {
  if (phase === 1) {
    const ask = await readJson(stageFile(paths, 'phase1_ask.json'));
    return synthesizePhase1Confirmed(ask, feedback, options);
  }
  if (phase === 2) {
    const ask = await readJson(stageFile(paths, 'phase2_ask.json'));
    return applyPhase2Selection(ask, feedback, options);
  }
  if (phase === 3) {
    const ask = await readJson(stageFile(paths, 'phase3_ask.json'));
    const phase2 = await readJson(stageFile(paths, 'phase2_confirmed.json'));
    return applyPhase3Selection(ask, feedback, phase2.states, options);
  }
  if (phase === 4) {
    const preview = await readJson(stageFile(paths, 'phase4_preview.json'));
    const metadata = {
      source_dir: session.source_dir,
      sources: {
        brief: session.paths.brief,
        page_dsl: session.paths.page_dsl,
        phase1_confirmed: relativeToRoot(stageFile(paths, 'phase1_confirmed.json')),
        phase2_confirmed: relativeToRoot(stageFile(paths, 'phase2_confirmed.json')),
        phase3_confirmed_by_id: relativeToRoot(stageFile(paths, 'phase3_confirmed_by_id.json')),
      },
    };
    return finalizePhase4(preview, feedback, metadata);
  }
  throw new Error(`Invalid phase: ${phase}`);
}

function normalizePhase1Revision(current, parsed) {
  const next = {
    ...current,
    ...(parsed || {}),
    action: 'confirmed',
    phase: 1,
    selections: clone(current.selections),
  };
  const fieldBySelection = {
    actor: 'actor',
    trigger: 'trigger',
    happy_path: 'happy_path',
    success_criteria: 'success_criteria',
  };
  next.custom_overrides = { ...(current.custom_overrides || {}) };
  for (const [selectionKey, field] of Object.entries(fieldBySelection)) {
    const previousText = current.selections?.[selectionKey]?.text || '';
    const revisedText = next[field] || previousText;
    next.selections[selectionKey] = {
      ...(current.selections?.[selectionKey] || {}),
      option_id: revisedText === previousText
        ? current.selections?.[selectionKey]?.option_id
        : 'custom',
      text: revisedText,
    };
    if (revisedText !== previousText) next.custom_overrides[selectionKey] = revisedText;
  }
  return next;
}

function normalizePhase2Revision(current, parsed) {
  const parsedStates = Array.isArray(parsed?.states) ? parsed.states : [];
  const proposed = normalizeOrderedStates(parsedStates, {
    initialState: current.states[0],
  });
  return {
    action: 'confirmed',
    phase: 2,
    states: proposed.length ? proposed : clone(current.states),
  };
}

function normalizePhase3Revision(current, parsed) {
  const proposed = parsed?.selections_by_state || {};
  const selections = {};
  for (const [stateId, selection] of Object.entries(current.selections_by_state || {})) {
    const revised = proposed[stateId] || {};
    const implementationPlan = revised.implementation_plan || selection.implementation_plan;
    selections[stateId] = {
      option_id: implementationPlan === selection.implementation_plan
        ? selection.option_id
        : 'custom',
      implementation_plan: implementationPlan,
    };
  }
  return {
    action: 'confirmed',
    phase: 3,
    selections_by_state: selections,
  };
}

function normalizePhase4Revision(current, parsed) {
  const parsedStates = Object.values(parsed?.merged_states_by_id || {});
  const currentInitial = current.merged_states_by_id?.state_1;
  const normalizedStates = normalizeOrderedStates(parsedStates, {
    initialState: currentInitial,
    requireImplementation: true,
  });
  const mergedStates = statesToMap(normalizedStates);
  return {
    ...current,
    ...(parsed || {}),
    action: 'done',
    phase: 4,
    source_dir: current.source_dir,
    sources: current.sources,
    generated_at: current.generated_at,
    merged_states_by_id: mergedStates,
  };
}

function normalizeRevision(phase, current, parsed) {
  if (phase === 1) return normalizePhase1Revision(current, parsed);
  if (phase === 2) return normalizePhase2Revision(current, parsed);
  if (phase === 3) return normalizePhase3Revision(current, parsed);
  if (phase === 4) return normalizePhase4Revision(current, parsed);
  throw new Error(`Invalid phase: ${phase}`);
}

function revisionContract(phase) {
  if (phase === 1) {
    return 'Return the complete Phase 1 confirmed object. Preserve the selected option metadata. Keep a complete user_story and valid acceptance_criteria_steps containing given, when, and then.';
  }
  if (phase === 2) {
    return [
      'Return the complete Phase 2 confirmed object.',
      'The user may add, delete, reorder, rename, or revise states.',
      'The returned states array is authoritative and must contain the entire revised sequence.',
      'If the user asks to add one state, the returned states length must increase by one; if asked to delete one, it must decrease by one.',
      'Keep state_1 as the first state and number all states contiguously as state_1 through state_N in flow order.',
      'Update all state references inside descriptions after insertion, deletion, or reordering.',
      'Every description must contain 触发条件：, 展示信息：, 继承信息：.',
    ].join(' ');
  }
  if (phase === 3) {
    return 'Return the complete Phase 3 confirmed object. Preserve exactly the same selections_by_state keys. Each state must have a complete implementation_plan.';
  }
  return [
    'Return the complete Phase 4 done object.',
    'The user may add, delete, reorder, rename, or revise merged states.',
    'merged_states_by_id is authoritative and must contain the entire revised state sequence.',
    'If the user asks to add one state, the state count must increase by one; if asked to delete one, it must decrease by one.',
    'Keep state_1 first and number all states contiguously as state_1 through state_N in flow order.',
    'Update all state references after insertion, deletion, or reordering.',
    'Every non-state_1 state, including newly added states, must include a complete implementation.implementation_plan.',
    'Preserve sources, source_dir, brief, user_story_confirmed, and page_dsl unless the feedback explicitly asks to revise them.',
    'state_1 implementation must remain null.',
  ].join(' ');
}

function stateCount(value, phase) {
  if (phase === 2) return Array.isArray(value?.states) ? value.states.length : 0;
  if (phase === 4) return Object.keys(value?.merged_states_by_id || {}).length;
  return 0;
}

function stateCountIssues(phase, current, revised, feedbackText) {
  if (![2, 4].includes(phase)) return [];
  const feedback = String(feedbackText || '');
  const asksToAdd = /(新增|增加|添加|插入|补充|add|insert)/i.test(feedback);
  const asksToDelete = /(删除|移除|去掉|删掉|remove|delete)/i.test(feedback);
  if (asksToAdd === asksToDelete) return [];
  const before = stateCount(current, phase);
  const after = stateCount(revised, phase);
  if (asksToAdd && after <= before) {
    return [`用户要求新增状态，但状态数量未增加：修改前 ${before}，修改后 ${after}`];
  }
  if (asksToDelete && after >= before) {
    return [`用户要求删除状态，但状态数量未减少：修改前 ${before}，修改后 ${after}`];
  }
  return [];
}

async function buildPhaseDraft(sessionDir, phase, selectionFeedback, options = {}) {
  const paths = await loadSession(sessionDir);
  assertCanConfirm(paths.session, phase);
  const output = await composePhaseOutput(paths, paths.session, phase, selectionFeedback, options);
  const report = validatePhase(phase, 'confirmed', output, await phaseContext(paths, phase));
  if (!report.valid) {
    throw new ValidationError(`Phase ${phase} selected content validation failed`, report);
  }
  return output;
}

async function revisePhaseDraft(sessionDir, phase, current, feedbackText) {
  const paths = await loadSession(sessionDir);
  assertCanConfirm(paths.session, phase);
  const context = await phaseContext(paths, phase);
  let validationIssues = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const system = [
      `You revise an already composed Phase ${phase} blueprint result from natural-language user feedback.`,
      'Return ONLY one strict JSON object containing the complete revised Phase result.',
      'Do not return options, explanations, markdown, patches, diffs, or partial fields.',
      'Modify the current complete content semantically according to the feedback; do not perform literal string replacement.',
      'Do not add back options or states that the user did not select.',
      revisionContract(phase),
    ].join('\n');
    const user = JSON.stringify({
      task: `Revise the complete Phase ${phase} content.`,
      user_feedback: feedbackText,
      current_complete_content: current,
      previous_validation_issues: validationIssues,
    }, null, 2);
    const rawText = await callQwen({ system, user, model: paths.session.model });
    const revised = normalizeRevision(phase, current, extractJSON(rawText));
    const report = validatePhase(phase, 'confirmed', revised, context);
    const countIssues = stateCountIssues(phase, current, revised, feedbackText);
    if (report.valid && countIssues.length === 0) return revised;
    validationIssues = [...report.issues, ...countIssues];
  }
  throw new ValidationError(`Phase ${phase} model revision validation failed`, {
    phase,
    kind: 'confirmed',
    valid: false,
    issues: validationIssues,
    checked_at: new Date().toISOString(),
  });
}

async function writeValidationOrThrow(sessionDir, paths, phase, kind, payload, context) {
  const report = validatePhase(phase, kind, payload, context);
  await writeJson(validationFile(paths, `phase${phase}_report.json`), report);
  if (!report.valid) {
    await patchSession(sessionDir, { status: 'failed' });
    throw new ValidationError(`Phase ${phase} ${kind} validation failed`, report);
  }
  return report;
}

async function writeAsk(sessionDir, paths, session, phase, ask, raw, context = {}) {
  await writeJson(logFile(paths, `phase${phase}_raw.json`), raw);
  await writeJson(stageFile(paths, `phase${phase}_ask.json`), ask);
  await writeValidationOrThrow(sessionDir, paths, phase, 'ask', ask, context);
  await patchSession(sessionDir, {
    status: 'awaiting_confirm',
    current_phase: phase,
  });
  return ask;
}

async function runPhase1Generate(sessionDir) {
  const paths = await loadSession(sessionDir);
  const { session } = paths;
  assertCanGenerate(session, 1);
  await patchSession(sessionDir, { status: 'generating' });
  const brief = readSessionText(session, 'brief');
  const pageDsl = readPageDsl(session);
  const system = [
    'You are taskflow-user-story interactive generate mode.',
    'Return ONLY strict JSON.',
    'Do not return a confirmed user story. Return an ask payload with four option groups.',
    'Each group must have 2-4 options, except Success Criteria has 2-3.',
    'Each group must have exactly one default:true option.',
    'Required shape: {"action":"ask","phase":1,"questionText":"...","multiSelect":true,"allowCustom":true,"note":"...","options":[{"id":"actor_1","group":"① Actor · 主角","label":"...","rationale":"...","default":true}]}',
    skillDoc('sub-skills/user-story/SKILL.md'),
  ].join('\n\n');
  const user = JSON.stringify({
    task: 'Generate phase1_ask.json only.',
    brief,
    page_dsl: clip(pageDsl, 14000),
    required_groups: [
      '① Actor · 主角',
      '② Trigger · 触发点',
      '③ Goal & Happy Path · 核心目标与理想路径',
      '④ Success Criteria · 成功判定',
    ],
  }, null, 2);
  const rawText = await callQwen({ system, user, model: session.model });
  const ask = normalizePhase1Ask(extractJSON(rawText));
  return writeAsk(sessionDir, paths, session, 1, ask, { raw_text: rawText, parsed: ask });
}

async function runPhase2Generate(sessionDir) {
  const paths = await loadSession(sessionDir);
  const { session } = paths;
  assertCanGenerate(session, 2);
  await patchSession(sessionDir, { status: 'generating' });
  const brief = readSessionText(session, 'brief');
  const pageDsl = readPageDsl(session);
  const phase1 = await readJson(stageFile(paths, 'phase1_confirmed.json'));
  const system = [
    'You are taskflow-state-enumeration interactive generate mode.',
    'Return ONLY strict JSON.',
    'Generate phase2_ask.json with happy-path states only.',
    'Default all states to true, state_1 must be first, and options length must be >= 4.',
    'Every description must contain these exact sections: 触发条件：, 展示信息：, 继承信息：.',
    'Every state must include a concise basis field. In one short sentence, cite a relevant design pattern or typical page from recognizable products or companies such as Apple, Taobao, Google, WeChat, Amazon, or others, and briefly explain why it informs this state. Do not use a rationale field.',
    skillDoc('sub-skills/state-enumeration/SKILL.md'),
  ].join('\n\n');
  const user = JSON.stringify({
    task: 'Generate phase2_ask.json only.',
    brief,
    phase1_confirmed: phase1,
    page_dsl: clip(pageDsl, 16000),
  }, null, 2);
  const rawText = await callQwen({ system, user, model: session.model });
  const ask = normalizePhase2Ask(extractJSON(rawText));
  return writeAsk(sessionDir, paths, session, 2, ask, { raw_text: rawText, parsed: ask });
}

async function runPhase3Generate(sessionDir) {
  const paths = await loadSession(sessionDir);
  const { session } = paths;
  assertCanGenerate(session, 3);
  await patchSession(sessionDir, { status: 'generating' });
  const brief = readSessionText(session, 'brief');
  const pageDsl = readPageDsl(session);
  const phase1 = await readJson(stageFile(paths, 'phase1_confirmed.json'));
  const phase2 = await readJson(stageFile(paths, 'phase2_confirmed.json'));
  const system = [
    'You are taskflow-implementation-plan interactive generate mode.',
    'Return ONLY strict JSON.',
    'Generate exactly ONE complete UI implementation plan for every non-state_1 state.',
    'Do not include state_1 in options.',
    'Use exactly one option per state, with id format state_N::implementation.',
    'The ask payload must set multiSelect:false and allowCustom:true.',
    'Do not output default fields. The user reviews the complete plan directly and revises it through natural-language feedback without selecting option numbers.',
    'Every option must include a concise basis field. In one short sentence, cite a relevant design idea or typical page from recognizable products or companies such as Apple, Taobao, Google, WeChat, Amazon, or others, and explain how it supports the proposed UI. Do not use a rationale field.',
    skillDoc('sub-skills/implementation-plan/SKILL.md'),
  ].join('\n\n');
  const user = JSON.stringify({
    task: 'Generate phase3_ask.json only.',
    brief,
    phase1_confirmed: phase1,
    phase2_confirmed: phase2,
    page_dsl: clip(pageDsl, 16000),
  }, null, 2);
  const rawText = await callQwen({ system, user, model: session.model });
  const ask = normalizePhase3Ask(extractJSON(rawText));
  return writeAsk(sessionDir, paths, session, 3, ask, { raw_text: rawText, parsed: ask }, { states: phase2.states });
}

async function runPhase4Build(sessionDir) {
  const paths = await loadSession(sessionDir);
  const { session } = paths;
  assertCanGenerate(session, 4);
  await patchSession(sessionDir, { status: 'generating' });
  const brief = readSessionText(session, 'brief');
  const pageDsl = readPageDsl(session);
  const phase1 = await readJson(stageFile(paths, 'phase1_confirmed.json'));
  const phase2 = await readJson(stageFile(paths, 'phase2_confirmed.json'));
  const phase3 = await readJson(stageFile(paths, 'phase3_confirmed_by_id.json'));
  const preview = buildPhase4Preview({ brief, pageDsl, phase1, phase2, phase3 });
  const report = validatePhase(4, 'preview', preview, { states: phase2.states });
  preview.validation_issues = report.issues;
  await writeJson(stageFile(paths, 'phase4_preview.json'), preview);
  await writeJson(validationFile(paths, 'phase4_report.json'), report);
  if (!report.valid) {
    await patchSession(sessionDir, { status: 'failed' });
    throw new ValidationError('Phase 4 preview validation failed', report);
  }
  await patchSession(sessionDir, {
    status: 'awaiting_confirm',
    current_phase: 4,
  });
  return preview;
}

async function generatePhase(sessionDir, phase) {
  const runners = {
    1: runPhase1Generate,
    2: runPhase2Generate,
    3: runPhase3Generate,
    4: runPhase4Build,
  };
  return runners[phase](sessionDir);
}

async function confirmPhase(sessionDir, phase, feedback = {}, options = {}) {
  const paths = await loadSession(sessionDir);
  const { session } = paths;
  assertCanConfirm(session, phase);
  const output = await composePhaseOutput(paths, session, phase, feedback, options);
  const report = validatePhase(phase, 'confirmed', output, await phaseContext(paths, phase));

  await writeJson(validationFile(paths, `phase${phase}_report.json`), report);
  if (!report.valid) {
    throw new ValidationError(`Phase ${phase} confirmation validation failed`, report);
  }
  if (phase === 1) await writeJson(stageFile(paths, 'phase1_confirmed.json'), output);
  if (phase === 2) await writeJson(stageFile(paths, 'phase2_confirmed.json'), output);
  if (phase === 3) await writeJson(stageFile(paths, 'phase3_confirmed_by_id.json'), output);
  if (phase === 4) await writeJson(stageFile(paths, 'blueprint_builder_input.json'), output);

  const completed = Array.from(new Set([...(session.completed_phases || []), phase])).sort((a, b) => a - b);
  await patchSession(sessionDir, {
    completed_phases: completed,
    current_phase: phase < 4 ? phase + 1 : 4,
    status: phase < 4 ? 'idle' : 'completed',
  });
  return output;
}

function latestStagePayload(paths, session) {
  if (session.status === 'awaiting_confirm') {
    const name = session.current_phase === 4 ? 'phase4_preview.json' : `phase${session.current_phase}_ask.json`;
    const file = stageFile(paths, name);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  if (session.status === 'completed') {
    const file = stageFile(paths, 'blueprint_builder_input.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
}

module.exports = {
  ValidationError,
  buildPhaseDraft,
  confirmPhase,
  generatePhase,
  latestStagePayload,
  normalizeRevision,
  revisePhaseDraft,
  stateCountIssues,
};
