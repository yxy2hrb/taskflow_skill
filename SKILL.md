---
name: taskflow-llm-pagegen
description: >
  Runs the self-contained taskflow pipeline that generates static taskflow pages
  from state_implementation_model with an LLM. Use when generating pages from
  case directories with preprocessing, blueprint creation, state implementation
  modeling, and static state layers.
---

# Taskflow LLM Pagegen

自包含编排 skill：prompt、组件库、runner 均在 **本目录**内。

详细运行说明、环境变量、分阶段命令见 **[README.md](./README.md)**。

## 快速开始

```bash
# 0. 安装依赖（仅 skill 内 node_modules）
npm install
npx playwright install chromium

# 1. 配置 API Key
cp .env.example .env   # 配置 DASHSCOPE_API_KEY、TEXT_MODEL、VISION_MODEL

# 2. 全流程（默认 code_gen2 + blueprint auto）
node scripts/run_skill.js examples/smoke_case --width 360 --height 792
```

## 默认行为

- `--codegen code_gen2`（React 组件 + SSR + page-layer 注入）
- `--blueprint-mode auto`（全自动蓝图，无需分阶段 confirm）
- page-layer 默认 **rule-only**（不加 `--llm`）且 **关闭 auto-fit**

## 子 skill

1. `sub-skills/preprocess` — bbox、语义标注、semantic_registry
2. `sub-skills/blueprint` — 四阶段任务流蓝图
3. `sub-skills/code_gen2` — state model、component codegen、page layer（默认）

旧版 `sub-skills/codegen` 仍可通过 `--codegen codegen` 选用。

## 约束

- 不依赖 skill 目录外的脚本或 `backend/.env`；npm 依赖仅来自本目录 `node_modules`。
- 路径参数支持相对（相对 cwd）与绝对路径。
- `.env` 放在本 skill 根目录。
