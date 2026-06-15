const { entriesForPayload } = require('./numbered_interaction');

function phase3StateTitle(entry) {
  const stateId = entry.state_id || String(entry.id || '').split('::')[0];
  const group = String(entry.group || '').trim();
  if (!group || group === stateId) return stateId;
  return group.startsWith(stateId) ? group : `${stateId} · ${group}`;
}

function renderOption(option, number, phase) {
  const lines = [`[${number}] ${option.label || option.id}`];
  if (option.label) lines.push(`  ID：${option.id}`);
  if (option.implementation_plan) lines.push(`  ${option.implementation_plan}`);
  if (option.description) lines.push(`  ${option.description.replace(/\n/g, '\n  ')}`);
  const basis = option.basis || option.rationale;
  if (basis) lines.push(`  ${phase === 2 ? '依据' : '原因'}：${basis}`);
  return lines.join('\n');
}

function renderAsk(payload) {
  if (payload.phase === 3) {
    return [
      'Phase 3 完整实现方案',
      ...entriesForPayload(payload).flatMap((entry) => [
        '',
        phase3StateTitle(entry),
        `实现方案：${entry.implementation_plan || ''}`,
        ...(entry.basis ? [`依据：${entry.basis}`] : []),
      ]),
      '',
      '直接输入修改意见，或输入 next/done/下一步进入 Phase 4。',
    ].join('\n');
  }
  const lines = [
    `Phase ${payload.phase}: ${payload.questionText || '待确认'}`,
    payload.note || '',
  ].filter(Boolean);
  let currentGroup = '';
  for (const entry of entriesForPayload(payload)) {
    const option = entry.raw;
    if (option.group && option.group !== currentGroup) {
      currentGroup = option.group;
      lines.push('', currentGroup);
    }
    lines.push(renderOption(option, entry.number, payload.phase));
  }
  lines.push('', payload.phase === 1
    ? '输入方式：输入四个编号，每组一个，例如 1,3,6,9。'
    : '输入方式：输入要保留的编号，例如 1,2,4,5。');
  return lines.join('\n');
}

function renderPreview(payload) {
  const lines = ['Phase 4 蓝图预览'];
  for (const entry of entriesForPayload(payload)) {
    const state = entry.raw;
    lines.push('', `[${entry.number}] ${entry.id} · ${state.label}`, state.description || '');
    if (state.implementation?.implementation_plan) {
      lines.push(`实现：${state.implementation.implementation_plan}`);
    }
  }
  if (payload.validation_issues?.length) {
    lines.push('', '校验问题：', ...payload.validation_issues.map((issue) => `- ${issue}`));
  }
  lines.push('', '输入方式：输入要保留原内容的编号；直接回车表示全部保留。');
  return lines.join('\n');
}

function renderView(payload) {
  return payload?.action === 'preview' ? renderPreview(payload) : renderAsk(payload);
}

function renderConfirmedView(payload, context = {}) {
  if (payload?.phase === 1) {
    return [
      'Phase 1 完整 User Story',
      '',
      `主角：${payload.actor || ''}`,
      `触发点：${payload.trigger || ''}`,
      `目标与理想路径：${payload.happy_path || ''}`,
      `成功判定：${payload.success_criteria || ''}`,
      `User Story：${payload.user_story || ''}`,
      '验收标准：',
      ...(payload.acceptance_criteria_steps || []).map((step) => `- ${String(step.type || '').toUpperCase()}：${step.text || ''}`),
    ].join('\n');
  }
  if (payload?.phase === 2) {
    return [
      'Phase 2 完整状态序列',
      ...(payload.states || []).flatMap((state, index) => [
        '',
        `[${index + 1}] ${state.id} · ${state.label}`,
        state.description || '',
      ]),
    ].join('\n');
  }
  if (payload?.phase === 3) {
    const titleByState = new Map(
      entriesForPayload(context.phase3Ask || {}).map((entry) => [
        entry.state_id,
        phase3StateTitle(entry),
      ]),
    );
    const basisByState = new Map(
      entriesForPayload(context.phase3Ask || {}).map((entry) => [
        entry.state_id,
        entry.basis || '',
      ]),
    );
    return [
      'Phase 3 完整实现方案',
      ...Object.entries(payload.selections_by_state || {}).flatMap(([stateId, selection]) => [
        '',
        titleByState.get(stateId) || stateId,
        `实现方案：${selection.implementation_plan || ''}`,
        ...(basisByState.get(stateId)
          ? [`依据：${basisByState.get(stateId)}`]
          : []),
      ]),
    ].join('\n');
  }
  if (payload?.phase === 4) {
    return renderPreview({
      ...payload,
      action: 'preview',
      validation_issues: [],
    }).replace('Phase 4 蓝图预览', 'Phase 4 完整蓝图');
  }
  return JSON.stringify(payload, null, 2);
}

module.exports = { renderConfirmedView, renderView };
