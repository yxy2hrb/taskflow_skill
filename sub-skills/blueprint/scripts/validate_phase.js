const GROUPS = {
  actor: '① Actor · 主角',
  trigger: '② Trigger · 触发点',
  happy_path: '③ Goal & Happy Path · 核心目标与理想路径',
  success_criteria: '④ Success Criteria · 成功判定',
};

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateOption(option, required, prefix, issues) {
  if (!isObject(option)) {
    issues.push(`${prefix} must be an object`);
    return;
  }
  for (const key of required) {
    if (option[key] == null || option[key] === '') issues.push(`${prefix}.${key} is required`);
  }
}

function validatePhase1Ask(payload) {
  const issues = [];
  if (payload?.action !== 'ask') issues.push('action must be ask');
  if (payload?.phase !== 1) issues.push('phase must be 1');
  if (!Array.isArray(payload?.options)) issues.push('options must be an array');
  const options = Array.isArray(payload?.options) ? payload.options : [];
  const ids = new Set();
  options.forEach((option, index) => {
    validateOption(option, ['id', 'group', 'label', 'rationale'], `options[${index}]`, issues);
    if (ids.has(option?.id)) issues.push(`duplicate option id ${option.id}`);
    ids.add(option?.id);
  });
  for (const [key, group] of Object.entries(GROUPS)) {
    const groupOptions = options.filter((option) => option.group === group);
    const max = key === 'success_criteria' ? 3 : 4;
    if (groupOptions.length < 2 || groupOptions.length > max) {
      issues.push(`${group} must contain 2-${max} options`);
    }
    if (groupOptions.filter((option) => option.default === true).length !== 1) {
      issues.push(`${group} must contain exactly one default option`);
    }
  }
  return issues;
}

function validatePhase1Confirmed(payload) {
  const issues = [];
  if (payload?.action !== 'confirmed') issues.push('action must be confirmed');
  if (payload?.phase !== 1) issues.push('phase must be 1');
  for (const key of ['actor', 'trigger', 'happy_path', 'success_criteria', 'user_story', 'platform']) {
    if (!payload?.[key]) issues.push(`${key} is required`);
  }
  if (!isObject(payload?.selections)) issues.push('selections must be an object');
  for (const key of Object.keys(GROUPS)) {
    if (!isObject(payload?.selections?.[key])) issues.push(`selections.${key} is required`);
  }
  if (!Array.isArray(payload?.acceptance_criteria_steps)) {
    issues.push('acceptance_criteria_steps must be an array');
  } else {
    const allowed = new Set(['given', 'when', 'then', 'and', 'but']);
    for (const [index, step] of payload.acceptance_criteria_steps.entries()) {
      if (!allowed.has(step?.type) || !step?.text) issues.push(`acceptance_criteria_steps[${index}] is invalid`);
    }
    for (const type of ['given', 'when', 'then']) {
      if (!payload.acceptance_criteria_steps.some((step) => step.type === type)) {
        issues.push(`acceptance_criteria_steps requires ${type}`);
      }
    }
  }
  return issues;
}

function validateState(state, index, issues, confirmed) {
  validateOption(state, ['id', 'label', 'description'], `states[${index}]`, issues);
  if (!confirmed) validateDesignBasis(state?.basis, `states[${index}].basis`, issues);
  const description = String(state?.description || '');
  for (const section of ['触发条件：', '展示信息：', '继承信息：']) {
    if (!description.includes(section)) issues.push(`states[${index}].description missing ${section}`);
  }
}

function validateDesignBasis(value, path, issues) {
  const basis = String(value || '').trim();
  if (!basis) {
    issues.push(`${path} is required`);
    return;
  }
  if (basis.length > 120) issues.push(`${path} must be concise and no longer than 120 characters`);
  if (!/(参考|借鉴)/.test(basis)) issues.push(`${path} must identify a reference`);
}

function validatePhase2Ask(payload) {
  const issues = [];
  if (payload?.action !== 'ask') issues.push('action must be ask');
  if (payload?.phase !== 2) issues.push('phase must be 2');
  const options = Array.isArray(payload?.options) ? payload.options : [];
  if (options.length < 4) issues.push('options length must be >= 4');
  if (options[0]?.id !== 'state_1') issues.push('first option must be state_1');
  options.forEach((state, index) => validateState(state, index, issues, false));
  if (new Set(options.map((state) => state.id)).size !== options.length) issues.push('state ids must be unique');
  return issues;
}

function validatePhase2Confirmed(payload) {
  const issues = [];
  if (payload?.action !== 'confirmed') issues.push('action must be confirmed');
  if (payload?.phase !== 2) issues.push('phase must be 2');
  const states = Array.isArray(payload?.states) ? payload.states : [];
  if (states.length < 4) issues.push('states length must be >= 4');
  if (states[0]?.id !== 'state_1') issues.push('state_1 cannot be removed and must remain first');
  states.forEach((state, index) => {
    validateState(state, index, issues, true);
    if ('rationale' in (state || {}) || 'basis' in (state || {})) {
      issues.push(`states[${index}] must not contain rationale or basis`);
    }
  });
  if (new Set(states.map((state) => state.id)).size !== states.length) issues.push('state ids must be unique');
  return issues;
}

function stateIdFromOption(option) {
  return String(option?.id || '').match(/^(state_\d+)::/)?.[1]
    || String(option?.group || '').match(/^(state_\d+)\b/)?.[1]
    || '';
}

function validatePhase3Ask(payload, context = {}) {
  const issues = [];
  if (payload?.action !== 'ask') issues.push('action must be ask');
  if (payload?.phase !== 3) issues.push('phase must be 3');
  if (payload?.multiSelect !== false) issues.push('multiSelect must be false');
  const options = Array.isArray(payload?.options) ? payload.options : [];
  const expected = (context.states || []).filter((state) => state.id !== 'state_1').map((state) => state.id);
  const grouped = new Map();
  options.forEach((option, index) => {
    validateOption(option, ['id', 'group', 'implementation_plan'], `options[${index}]`, issues);
    validateDesignBasis(option?.basis, `options[${index}].basis`, issues);
    const stateId = stateIdFromOption(option);
    if (!stateId) issues.push(`options[${index}] has invalid state id`);
    if (stateId === 'state_1') issues.push('state_1 must not appear in phase3 options');
    if (stateId && option.id !== `${stateId}::implementation`) {
      issues.push(`options[${index}].id must be ${stateId}::implementation`);
    }
    if (Object.prototype.hasOwnProperty.call(option || {}, 'default')) {
      issues.push(`options[${index}] must not contain default`);
    }
    if (!grouped.has(stateId)) grouped.set(stateId, []);
    grouped.get(stateId).push(option);
  });
  for (const stateId of expected) {
    const group = grouped.get(stateId) || [];
    if (group.length !== 1) issues.push(`${stateId} must contain exactly one implementation`);
  }
  for (const stateId of grouped.keys()) {
    if (!expected.includes(stateId)) issues.push(`unexpected phase3 group ${stateId}`);
  }
  return issues;
}

function validatePhase3Confirmed(payload, context = {}) {
  const issues = [];
  if (payload?.action !== 'confirmed') issues.push('action must be confirmed');
  if (payload?.phase !== 3) issues.push('phase must be 3');
  if (!isObject(payload?.selections_by_state)) issues.push('selections_by_state must be an object');
  const expected = (context.states || []).filter((state) => state.id !== 'state_1').map((state) => state.id);
  for (const stateId of expected) {
    const selection = payload?.selections_by_state?.[stateId];
    if (!isObject(selection)) {
      issues.push(`missing selection for ${stateId}`);
      continue;
    }
    if (!selection.option_id) issues.push(`${stateId}.option_id is required`);
    if (selection.option_id && ![`${stateId}::implementation`, 'custom'].includes(selection.option_id)) {
      issues.push(`${stateId}.option_id must be ${stateId}::implementation or custom`);
    }
    if (!selection.implementation_plan) issues.push(`${stateId}.implementation_plan is required`);
  }
  for (const stateId of Object.keys(payload?.selections_by_state || {})) {
    if (!expected.includes(stateId)) issues.push(`unexpected selection ${stateId}`);
  }
  return issues;
}

function validatePhase4Preview(payload, context = {}) {
  const issues = [];
  if (payload?.action !== 'preview') issues.push('action must be preview');
  if (payload?.phase !== 4) issues.push('phase must be 4');
  if (!payload?.brief) issues.push('brief is required');
  if (!isObject(payload?.user_story_confirmed)) issues.push('user_story_confirmed is required');
  if (!isObject(payload?.merged_states_by_id)) issues.push('merged_states_by_id is required');
  if (payload?.page_dsl == null) issues.push('page_dsl is required');
  if (payload?.merged_states_by_id?.state_1?.implementation !== null) {
    issues.push('state_1 implementation must be null');
  }
  const states = Object.values(payload?.merged_states_by_id || {});
  if (states.length < 4) issues.push('merged states length must be >= 4');
  states.forEach((state, index) => {
    const expectedId = `state_${index + 1}`;
    if (state?.id !== expectedId) issues.push(`merged state at index ${index} must be ${expectedId}`);
    validateState(state, index, issues, true);
    if (state?.id !== 'state_1' && !state?.implementation?.implementation_plan) {
      issues.push(`missing implementation for ${state?.id || expectedId}`);
    }
  });
  return issues;
}

function validatePhase4Confirmed(payload, context = {}) {
  const issues = validatePhase4Preview(
    { ...payload, action: 'preview' },
    context,
  );
  if (payload?.action !== 'done') issues.push('action must be done');
  if (payload?.phase !== 4) issues.push('phase must be 4');
  return issues;
}

function validatePhase(phase, kind, payload, context = {}) {
  const validators = {
    '1:ask': validatePhase1Ask,
    '1:confirmed': validatePhase1Confirmed,
    '2:ask': validatePhase2Ask,
    '2:confirmed': validatePhase2Confirmed,
    '3:ask': validatePhase3Ask,
    '3:confirmed': validatePhase3Confirmed,
    '4:preview': validatePhase4Preview,
    '4:confirmed': validatePhase4Confirmed,
  };
  const validate = validators[`${phase}:${kind}`];
  if (!validate) throw new Error(`No validator for phase ${phase} ${kind}`);
  const issues = validate(payload, context);
  return {
    phase,
    kind,
    valid: issues.length === 0,
    issues,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  GROUPS,
  stateIdFromOption,
  validatePhase,
};
