const fs = require('fs');
const path = require('path');
const { ROOT } = require('./session');

function readTextIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function loadDotEnv(file) {
  const text = readTextIfExists(file);
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] == null) process.env[match[1]] = value;
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

async function callQwen({ system, user, model }) {
  loadDotEnv(path.join(ROOT, 'backend', '.env'));
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseUrl = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  if (!apiKey) throw new Error('Missing DASHSCOPE_API_KEY or OPENAI_API_KEY.');
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: Number(process.env.MODEL_TEMPERATURE ?? 0),
          seed: Number(process.env.MODEL_SEED ?? 42),
          max_tokens: 7000,
          response_format: { type: 'json_object' },
        }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${body.slice(0, 1000)}`);
      const parsed = JSON.parse(body);
      return stripThink(parsed.choices?.[0]?.message?.content || '');
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
  throw lastError;
}

module.exports = {
  callQwen,
  clip,
  extractJSON,
  readTextIfExists,
  stripThink,
};
