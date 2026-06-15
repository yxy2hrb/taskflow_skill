const { GROUPS, stateIdFromOption } = require('./validate_phase');
const {
  normalizeSelectedStates,
  statesToMap,
} = require('./state_sequence');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function omit(object, keys) {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(object || {}).filter(([key]) => !blocked.has(key)));
}

function groupKey(group) {
  return Object.entries(GROUPS).find(([, value]) => value === group)?.[0] || '';
}

function findOption(ask, optionId) {
  return (ask.options || []).find((option) => option.id === optionId);
}

function normalizeSelectionInput(feedback) {
  if (Array.isArray(feedback?.selected_ids)) return feedback.selected_ids;
  if (Array.isArray(feedback?.option_ids)) return feedback.option_ids;
  if (Array.isArray(feedback?.selections)) return feedback.selections;
  return [];
}

function selectPhase1Options(ask, feedback, allowDefaults) {
  const selectedIds = normalizeSelectionInput(feedback);
  const selectionObject = feedback?.selections && !Array.isArray(feedback.selections) ? feedback.selections : {};
  const result = {};
  for (const key of Object.keys(GROUPS)) {
    const candidates = ask.options.filter((option) => groupKey(option.group) === key);
    const requested = selectionObject[key];
    const requestedId = typeof requested === 'string' ? requested : requested?.option_id;
    const selected = findOption(ask, requestedId)
      || candidates.find((option) => selectedIds.includes(option.id))
      || (allowDefaults ? candidates.find((option) => option.default) : null);
    if (!selected && !feedback?.custom_overrides?.[key] && !requested?.text) {
      throw new Error(`Phase 1 requires one explicit selection for ${key}.`);
    }
    result[key] = {
      option_id: selected?.id || 'custom',
      text: feedback?.custom_overrides?.[key] || requested?.text || selected?.label || '',
    };
  }
  return result;
}

function synthesizePhase1Confirmed(ask, feedback, { allowDefaults = false } = {}) {
  if (feedback?.action === 'confirmed' && feedback?.phase === 1) return clone(feedback);
  const selections = selectPhase1Options(ask, feedback || {}, allowDefaults);
  const overrides = feedback?.custom_overrides || {};
  const actor = selections.actor.text;
  const trigger = selections.trigger.text;
  const happyPath = selections.happy_path.text;
  const success = selections.success_criteria.text;
  const context = feedback?.context || '';
  const benefit = feedback?.benefit || `顺利完成${happyPath.split('→').pop()?.trim() || '目标任务'}`;
  const steps = Array.isArray(feedback?.acceptance_criteria_steps)
    ? feedback.acceptance_criteria_steps
    : [
      { type: 'given', text: context ? `${actor}处于${context}` : `${actor}已进入任务流起始页面` },
      { type: 'when', text: trigger },
      { type: 'and', text: happyPath },
      { type: 'then', text: success },
    ];
  const contextText = context ? `在${context}中，` : '';
  return {
    action: 'confirmed',
    phase: 1,
    selections,
    custom_overrides: overrides,
    actor,
    context,
    trigger,
    happy_path: happyPath,
    goal: feedback?.goal || happyPath,
    benefit,
    success_criteria: success,
    acceptance_criteria_steps: steps,
    user_story: feedback?.user_story
      || `作为${actor}，${contextText}当${trigger}时，我希望能${happyPath}，直到${success}为止。`,
    platform: feedback?.platform || ask.platform || 'mobile',
  };
}

function normalizeConfirmedState(state, index) {
  return {
    id: state.id || `state_${index + 1}`,
    label: state.label || state.state_name || `状态 ${index + 1}`,
    description: state.description || '',
  };
}

function applyPhase2Selection(ask, feedback, { allowDefaults = false } = {}) {
  if (feedback?.action === 'confirmed' && feedback?.phase === 2) return clone(feedback);
  if (Array.isArray(feedback?.states)) {
    return {
      action: 'confirmed',
      phase: 2,
      states: feedback.states.map(normalizeConfirmedState),
    };
  }
  const selectedIds = normalizeSelectionInput(feedback);
  const hasExplicitSelection = selectedIds.length > 0;
  const selected = ask.options.filter((state) => (
    state.id === 'state_1'
    || selectedIds.includes(state.id)
    || (!hasExplicitSelection && (allowDefaults || feedback?.confirm_all === true) && state.default !== false)
  ));
  const edits = feedback?.edits_by_id || {};
  const states = selected.map((state, index) => normalizeConfirmedState({
    ...state,
    ...(edits[state.id] || {}),
  }, index));
  for (const custom of feedback?.custom_states || []) {
    states.push(normalizeConfirmedState(custom, states.length));
  }
  const normalizedStates = normalizeSelectedStates(states, ask.options, {
    initialState: ask.options.find((state) => state.id === 'state_1'),
  });
  return { action: 'confirmed', phase: 2, states: normalizedStates };
}

function groupPhase3Options(ask) {
  const grouped = new Map();
  for (const option of ask.options || []) {
    const stateId = stateIdFromOption(option);
    if (!grouped.has(stateId)) grouped.set(stateId, []);
    grouped.get(stateId).push(option);
  }
  return grouped;
}

function applyPhase3Selection(ask, feedback, states) {
  if (feedback?.action === 'confirmed' && feedback?.phase === 3) return clone(feedback);
  const grouped = groupPhase3Options(ask);
  const direct = feedback?.selections_by_state || {};
  const edits = feedback?.edits_by_state || feedback?.implementations_by_state || {};
  const selections = {};
  for (const state of states.filter((item) => item.id !== 'state_1')) {
    const candidates = grouped.get(state.id) || [];
    const option = candidates[0];
    const requested = direct[state.id];
    const edit = edits[state.id];
    const editedPlan = typeof edit === 'string' ? edit : edit?.implementation_plan;
    const customPlan = editedPlan
      || requested?.implementation_plan
      || feedback?.custom_by_state?.[state.id]
      || feedback?.custom_implementations?.[state.id];
    if (!option) {
      throw new Error(`Phase 3 is missing the generated implementation for ${state.id}.`);
    }
    selections[state.id] = {
      option_id: customPlan ? 'custom' : option.id,
      implementation_plan: customPlan || option.implementation_plan,
    };
  }
  return {
    action: 'confirmed',
    phase: 3,
    selections_by_state: selections,
  };
}

function parseJsonOrText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function buildPhase4Preview({ brief, pageDsl, phase1, phase2, phase3 }) {
  const merged = {};
  for (const state of phase2.states) {
    const selection = phase3.selections_by_state[state.id];
    merged[state.id] = {
      ...omit(state, ['rationale', 'basis']),
      implementation: state.id === 'state_1'
        ? null
        : { implementation_plan: selection?.implementation_plan || '' },
    };
  }
  return {
    action: 'preview',
    phase: 4,
    brief,
    user_story_confirmed: omit(phase1, ['invest_check']),
    merged_states_by_id: merged,
    page_dsl: typeof pageDsl === 'string' ? parseJsonOrText(pageDsl) : pageDsl,
    validation_issues: [],
  };
}

function finalizePhase4(preview, feedback, metadata = {}) {
  if (feedback?.action === 'done' && feedback?.phase === 4) return clone(feedback);
  const edits = feedback?.merged_states_by_id || feedback?.preview?.merged_states_by_id || null;
  const selectedIds = Array.isArray(feedback?.selected_ids) && feedback.selected_ids.length
    ? new Set(feedback.selected_ids)
    : null;
  const sourceStates = Object.entries(preview.merged_states_by_id || {})
    .filter(([stateId]) => !selectedIds || selectedIds.has(stateId));
  const edited = edits
    ? Object.fromEntries(sourceStates.map(([stateId, state]) => [
      stateId,
      {
        ...state,
        ...(edits[stateId] || {}),
        implementation: edits[stateId]?.implementation === undefined ? state.implementation : edits[stateId].implementation,
      },
    ]))
    : Object.fromEntries(sourceStates);
  const normalizedStates = normalizeSelectedStates(
    Object.values(edited),
    Object.values(preview.merged_states_by_id || {}),
    {
      initialState: preview.merged_states_by_id?.state_1,
      requireImplementation: true,
    },
  );
  return {
    action: 'done',
    phase: 4,
    source_dir: metadata.source_dir,
    generated_at: new Date().toISOString(),
    sources: metadata.sources || {},
    brief: feedback?.brief || preview.brief,
    user_story_confirmed: feedback?.user_story_confirmed || preview.user_story_confirmed,
    merged_states_by_id: statesToMap(normalizedStates),
    page_dsl: feedback?.page_dsl ?? preview.page_dsl,
  };
}

module.exports = {
  applyPhase2Selection,
  applyPhase3Selection,
  buildPhase4Preview,
  finalizePhase4,
  synthesizePhase1Confirmed,
};
