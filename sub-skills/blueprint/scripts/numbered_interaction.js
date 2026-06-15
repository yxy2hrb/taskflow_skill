const fs = require('fs/promises');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const { GROUPS, stateIdFromOption } = require('./validate_phase');

function entriesForPayload(payload) {
  if (payload?.action === 'preview') {
    return Object.entries(payload.merged_states_by_id || {}).map(([stateId, state], index) => ({
      number: index + 1,
      id: stateId,
      group: '',
      label: state.label || stateId,
      description: state.description || '',
      implementation_plan: state.implementation?.implementation_plan || '',
      raw: state,
    }));
  }
  return (payload?.options || []).map((option, index) => ({
    number: index + 1,
    id: option.id,
    state_id: stateIdFromOption(option),
    group: option.group || '',
    label: option.label || '',
    description: option.description || '',
    implementation_plan: option.implementation_plan || '',
    basis: option.basis || option.rationale || '',
    default: option.default,
    raw: option,
  }));
}

function parseNumberList(text) {
  const value = String(text || '').trim();
  if (!value || /^(all|全部)$/i.test(value)) return [];
  const parts = value.split(/[,，\s]+/).filter(Boolean);
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((number) => !Number.isInteger(number) || number < 1)) {
    throw new Error('编号必须是正整数，并使用逗号分隔。');
  }
  return Array.from(new Set(numbers));
}

function parseEditLine(line) {
  const match = String(line || '').trim().match(/^(\d+)\s*(?:=|:|：|\s)\s*(.+)$/);
  if (!match) throw new Error(`无法解析修改内容：${line}`);
  return { number: Number(match[1]), content: match[2].trim() };
}

function entryByNumber(entries, number) {
  const entry = entries.find((item) => item.number === number);
  if (!entry) throw new Error(`不存在编号 ${number}。`);
  return entry;
}

function groupKey(group) {
  return Object.entries(GROUPS).find(([, label]) => label === group)?.[0] || '';
}

function splitFields(content, count) {
  const parts = String(content || '').split(/\s*\|\s*/);
  while (parts.length < count) parts.push('');
  return parts.slice(0, count);
}

function buildPhase1Feedback(entries, selectedNumbers, edits) {
  if (!selectedNumbers.length) throw new Error('Phase 1 必须输入四个选项编号。');
  const selections = {};
  const custom_overrides = {};
  for (const number of selectedNumbers) {
    const entry = entryByNumber(entries, number);
    const key = groupKey(entry.group);
    if (!key) throw new Error(`编号 ${number} 不属于 Phase 1 的有效分组。`);
    if (selections[key]) throw new Error(`${entry.group} 只能选择一个编号。`);
    selections[key] = entry.id;
    if (edits.has(number)) custom_overrides[key] = edits.get(number);
  }
  for (const key of Object.keys(GROUPS)) {
    if (!selections[key]) throw new Error(`Phase 1 缺少 ${GROUPS[key]} 的选择。`);
  }
  const selectedSet = new Set(selectedNumbers);
  for (const number of edits.keys()) {
    entryByNumber(entries, number);
    if (!selectedSet.has(number)) throw new Error(`编号 ${number} 未被选择，不能修改。`);
  }
  return { selections, custom_overrides };
}

function buildPhase2Feedback(entries, selectedNumbers, edits) {
  if (!selectedNumbers.length) throw new Error('Phase 2 必须输入要保留的状态编号。');
  const selected = selectedNumbers.map((number) => entryByNumber(entries, number));
  const state1 = entries.find((entry) => entry.id === 'state_1');
  if (state1 && !selected.some((entry) => entry.id === 'state_1')) {
    throw new Error(`state_1 不可删除，请保留编号 ${state1.number}。`);
  }
  const selectedSet = new Set(selectedNumbers);
  const edits_by_id = {};
  for (const [number, content] of edits) {
    if (!selectedSet.has(number)) throw new Error(`编号 ${number} 未被保留，不能修改。`);
    const entry = entryByNumber(entries, number);
    const [label, description] = splitFields(content, 2);
    edits_by_id[entry.id] = description
      ? { label: label || entry.label, description }
      : { label };
  }
  return {
    selected_ids: selected.map((entry) => entry.id),
    edits_by_id,
  };
}

function buildPhase3Feedback(entries, selectedNumbers, edits) {
  selectedNumbers.forEach((number) => entryByNumber(entries, number));
  const keep = new Set(selectedNumbers.length ? selectedNumbers : entries.map((entry) => entry.number));
  const edits_by_state = {};
  for (const [number, content] of edits) {
    const entry = entryByNumber(entries, number);
    edits_by_state[entry.state_id] = { implementation_plan: content };
  }
  const missing = entries.filter((entry) => !keep.has(entry.number) && !edits.has(entry.number));
  if (missing.length) {
    throw new Error(`未保留的编号必须提供修改内容：${missing.map((entry) => entry.number).join(', ')}`);
  }
  return { edits_by_state };
}

function buildPhase4Feedback(entries, selectedNumbers, edits) {
  selectedNumbers.forEach((number) => entryByNumber(entries, number));
  const keep = new Set(selectedNumbers.length ? selectedNumbers : entries.map((entry) => entry.number));
  const merged_states_by_id = {};
  for (const [number, content] of edits) {
    const entry = entryByNumber(entries, number);
    const [label, description, implementationPlan] = splitFields(content, 3);
    if (content.includes('|')) {
      merged_states_by_id[entry.id] = {
        ...(label ? { label } : {}),
        ...(description ? { description } : {}),
        ...(implementationPlan && entry.id !== 'state_1'
          ? { implementation: { implementation_plan: implementationPlan } }
          : {}),
      };
    } else if (entry.id === 'state_1') {
      merged_states_by_id[entry.id] = { description: content };
    } else {
      merged_states_by_id[entry.id] = {
        implementation: { implementation_plan: content },
      };
    }
  }
  return {
    selected_ids: entries.filter((entry) => keep.has(entry.number)).map((entry) => entry.id),
    ...(Object.keys(merged_states_by_id).length ? { merged_states_by_id } : {}),
    confirm: true,
  };
}

function buildFeedback(payload, selectedNumbers, edits) {
  const entries = entriesForPayload(payload);
  if (payload.phase === 1) return buildPhase1Feedback(entries, selectedNumbers, edits);
  if (payload.phase === 2) return buildPhase2Feedback(entries, selectedNumbers, edits);
  if (payload.phase === 3) return buildPhase3Feedback(entries, selectedNumbers, edits);
  if (payload.phase === 4) return buildPhase4Feedback(entries, selectedNumbers, edits);
  throw new Error(`不支持 Phase ${payload.phase} 的编号交互。`);
}

function selectionPrompt(phase) {
  if (phase === 1) return '请输入四个选项编号（每组一个，逗号分隔）：';
  if (phase === 2) return '请输入要保留的状态编号（逗号分隔）：';
  return '请输入要保留原内容的编号（逗号分隔，直接回车表示全部保留）：';
}

function modificationHint(phase) {
  if (phase === 2) return 'Phase 2 可输入“新名称”，或“新名称 | 完整描述”。';
  if (phase === 4) return 'Phase 4 可输入实现内容，或“名称 | 描述 | 实现”。';
  return '输入新的完整内容。';
}

function isNextCommand(value) {
  return /^(next|done|confirm|下一步|进入下一阶段|进入下一phase|确认|完成)$/i.test(String(value || '').trim());
}

async function promptForModelRevision(payload, {
  createDraft,
  reviseDraft,
  renderDraft,
}) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const selectedNumbers = [];
    if (payload.phase !== 3) {
      const selectedText = await rl.question(`${selectionPrompt(payload.phase)}\n> `);
      selectedNumbers.push(...parseNumberList(selectedText));
    }
    const selectionFeedback = buildFeedback(payload, selectedNumbers, new Map());
    let draft = await createDraft(selectionFeedback);

    if (payload.phase !== 3) {
      console.log('\n--- 根据所选编号生成的完整内容 ---\n');
    }
    console.log(renderDraft(draft));

    while (true) {
      const feedback = (await rl.question(
        '\n请输入修改意见；输入 next/done/下一步，确认当前内容并进入下一 Phase：\n> ',
      )).trim();
      if (!feedback || isNextCommand(feedback)) return draft;

      console.log('\n正在根据修改意见重新生成当前 Phase 的完整内容...');
      draft = await reviseDraft(draft, feedback);
      console.log(payload.phase === 3
        ? '\n--- 修改后的 Phase 3 实现方案 ---\n'
        : '\n--- 模型修改后的完整内容 ---\n');
      console.log(renderDraft(draft));
    }
  } finally {
    rl.close();
  }
}

async function promptForFeedback(payload, revisionHandlers = null) {
  if (!stdin.isTTY) {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    return revisionHandlers ? parseNumberedRevisionText(payload, text) : parseNumberedText(payload, text);
  }
  if (revisionHandlers) {
    return promptForModelRevision(payload, revisionHandlers);
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const selectedText = await rl.question(`${selectionPrompt(payload.phase)}\n> `);
    const selectedNumbers = parseNumberList(selectedText);
    const edits = new Map();
    console.log('\n如需修改，请输入对应编号；无需修改请输入 done。');
    console.log(modificationHint(payload.phase));
    while (true) {
      const answer = (await rl.question('要修改的编号（或 done）：\n> ')).trim();
      if (!answer || /^done$/i.test(answer) || answer === '完成') break;
      const number = Number(answer);
      entryByNumber(entriesForPayload(payload), number);
      const content = (await rl.question('请输入新的内容：\n> ')).trim();
      if (!content) throw new Error(`编号 ${number} 的修改内容不能为空。`);
      edits.set(number, content);
    }
    return buildFeedback(payload, selectedNumbers, edits);
  } finally {
    rl.close();
  }
}

function parseNumberedText(payload, text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const selectedNumbers = parseNumberList(lines.shift() || '');
  const edits = new Map();
  for (const line of lines) {
    if (/^done$/i.test(line) || line === '完成') break;
    const edit = parseEditLine(line);
    edits.set(edit.number, edit.content);
  }
  return buildFeedback(payload, selectedNumbers, edits);
}

function parseNumberedRevisionText(payload, text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (
    payload.phase === 3
    && lines.length
    && (/^(all|全部)$/i.test(lines[0]) || /^\d+(?:\s*[,，\s]\s*\d+)*$/.test(lines[0]))
  ) {
    lines.shift();
  }
  const selectedNumbers = payload.phase === 3
    ? []
    : parseNumberList(lines.shift() || '');
  const modificationFeedback = [];
  for (const line of lines) {
    if (isNextCommand(line)) break;
    const legacyEdit = line.match(/^(\d+)\s*(?:=|:|：)\s*(.+)$/);
    modificationFeedback.push(legacyEdit
      ? `请重点修改编号 ${legacyEdit[1]} 对应的内容：${legacyEdit[2].trim()}`
      : line);
  }
  return {
    __model_revision_script: true,
    selection_feedback: buildFeedback(payload, selectedNumbers, new Map()),
    modification_feedback: modificationFeedback,
  };
}

async function readFeedbackFile(file, payload) {
  const text = await fs.readFile(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    return parseNumberedRevisionText(payload, text);
  }
}

module.exports = {
  buildFeedback,
  entriesForPayload,
  parseNumberList,
  parseNumberedText,
  parseNumberedRevisionText,
  promptForFeedback,
  promptForModelRevision,
  readFeedbackFile,
};
