function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceStateReferences(value, idMap) {
  if (typeof value === 'string') {
    return value.replace(/\bstate_\d+\b/g, (stateId) => idMap.get(stateId) || stateId);
  }
  if (Array.isArray(value)) return value.map((item) => replaceStateReferences(item, idMap));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceStateReferences(item, idMap)]),
    );
  }
  return value;
}

function normalizeOrderedStates(states, {
  initialState = null,
  requireImplementation = false,
} = {}) {
  const proposed = Array.isArray(states)
    ? states.filter((state) => state && typeof state === 'object')
    : [];
  const withInitial = proposed.some((state) => state.id === 'state_1')
    ? proposed
    : [initialState, ...proposed].filter(Boolean);
  if (!withInitial.length) return [];

  const ordered = withInitial.map(clone);
  const state1Index = ordered.findIndex((state) => state.id === 'state_1');
  if (state1Index > 0) {
    const [state1] = ordered.splice(state1Index, 1);
    ordered.unshift(state1);
  }

  const idMap = new Map();
  ordered.forEach((state, index) => {
    const oldId = String(state.id || '');
    if (oldId && !idMap.has(oldId)) idMap.set(oldId, `state_${index + 1}`);
  });

  return ordered.map((state, index) => {
    const id = `state_${index + 1}`;
    const normalized = replaceStateReferences({
      ...state,
      label: state.label || state.state_name || `状态 ${index + 1}`,
      description: state.description || '',
    }, idMap);
    normalized.id = id;
    delete normalized.rationale;
    delete normalized.basis;
    delete normalized.default;
    delete normalized.group;
    if (id === 'state_1') {
      normalized.implementation = null;
    } else if (requireImplementation) {
      const implementationPlan = normalized.implementation?.implementation_plan
        || normalized.implementation_plan
        || '';
      normalized.implementation = { implementation_plan: implementationPlan };
      delete normalized.implementation_plan;
    } else {
      delete normalized.implementation;
      delete normalized.implementation_plan;
    }
    return normalized;
  });
}

function normalizeSelectedStates(selectedStates, originalStates, options = {}) {
  const retainedIds = new Set(
    (selectedStates || []).map((state) => state?.id).filter(Boolean),
  );
  const fallbackMap = new Map();
  let previousRetainedId = retainedIds.has('state_1') ? 'state_1' : '';

  for (const state of originalStates || []) {
    const stateId = state?.id;
    if (!stateId) continue;
    if (retainedIds.has(stateId)) previousRetainedId = stateId;
    fallbackMap.set(stateId, previousRetainedId || stateId);
  }

  const referencesRepaired = (selectedStates || []).map(
    (state) => replaceStateReferences(state, fallbackMap),
  );
  return normalizeOrderedStates(referencesRepaired, options);
}

function statesToMap(states) {
  return Object.fromEntries((states || []).map((state) => [state.id, state]));
}

module.exports = {
  normalizeOrderedStates,
  normalizeSelectedStates,
  replaceStateReferences,
  statesToMap,
};
