const fs = require('fs');
const path = require('path');
const { ROOT } = require('./session');
const { loadSkillEnv } = require('../../../scripts/paths');
const { callJsonChat } = require('../../../scripts/llm_config');

function readTextIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function stripThink(value) {
  return String(value || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extractJSON(raw) {
  let text = stripThink(raw);
  const markdown = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (markdown) text = markdown[1].trim();
  const jsonBody = text.match(/[\[{][\s\S]*[\]}]/);
  if (jsonBody) text = jsonBody[0];
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(
      text
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'"),
    );
  }
}

function clip(value, limit) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n\n<!-- clipped -->\n\n${text.slice(-half)}`;
}

async function callLLM({ system, user, model }) {
  loadSkillEnv();
  return callJsonChat({ system, user, model, maxTokens: 7000, label: 'blueprint' });
}

module.exports = {
  callLLM,
  callQwen: callLLM,
  clip,
  extractJSON,
  readTextIfExists,
  stripThink,
};
