# Taskflow LLM Pagegen

从 D2C HTML + 任务流 brief 生成多状态静态页面（preprocess → blueprint → state model → component codegen → page layer）。

本 skill 目录自包含：prompt、组件库、runner 脚本均在此目录内。将本目录复制到任意环境即可运行（需 Node.js 与外部 npm 依赖，见下文）。

## 前置条件

- **Node.js** ≥ 18（内置 `fetch`）
- **npm 依赖**：`playwright`、`react`、`react-dom`、`esbuild` 等  
  在 skill **同级或上级**工作区的 `node_modules` 中安装，或在 skill 目录执行 `npm install`（见「依赖安装」）。
- **Playwright 浏览器**（首次）：`npx playwright install chromium`

## 环境变量

1. 复制示例配置：

```bash
cp .env.example .env
```

2. 编辑 **本目录**下的 `.env`（`taskflow-llm-pagegen/.env`）：

| 变量 | 必需 | 说明 |
|---|---|---|
| `DASHSCOPE_API_KEY` | 是 | LLM API Key（也接受 `OPENAI_API_KEY` / `QWEN_API_KEY`） |
| `DASHSCOPE_BASE_URL` | 否 | OpenAI 兼容接口 Base URL（见 `.env.example`） |
| `TEXT_MODEL` | 是 | 文本 LLM 模型名（blueprint / state-model / component-codegen 等） |
| `VISION_MODEL` | 是 | 视觉 LLM 模型名（preprocess Stage0 从截图生成 spec） |
| `MODEL_TEMPERATURE` | 否 | 默认 `0` |
| `MODEL_SEED` | 否 | 默认 `42` |

所有 LLM 阶段优先读取 `<skill>/.env`。

## 案例目录结构

```
<caseDir>/
  html/Index.original.html    # 必需：D2C 源 HTML
  input.txt                   # 必需：任务流 brief
  wps_doc_0.png               # 可选：截图（无 spec.json 时用于生成 page DSL）
  spec.json                   # 可选：已有 page DSL 则跳过 Stage0 VL
```

一次完整 run 的产物：

```
<caseDir>/.run_skill/<stamp>/
  input_manifest.json
  preprocess/
  blueprint/
  state_implementation/
  code_gen2_component_codegen/
  code_gen2_llm_layer_codegen/
  run_report.json
```

## 全流程（推荐）

默认：**code_gen2** + **blueprint auto** + page-layer **rule-only**（不用 LLM 写占位层）+ **关闭 auto-fit**。

在**任意工作目录**下执行（路径支持**相对**与**绝对**；建议在 skill 根目录运行）：

```bash
cd taskflow-llm-pagegen
npm install && npx playwright install chromium
cp .env.example .env   # 配置 DASHSCOPE_API_KEY

# 内置 smoke 案例
node scripts/run_skill.js examples/smoke_case --width 360 --height 792

# 自定义案例
node scripts/run_skill.js ./my_case --width 360 --height 792
```

常用参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--codegen` | `code_gen2` | `code_gen2`（React 组件管线）或旧版 `codegen` |
| `--blueprint-mode` | `auto` | `auto` 全自动；`interactive` 分阶段人工确认 |
| `--model` | `$TEXT_MODEL` | 覆盖 `.env` 中的文本模型名 |
| `--width` / `--height` | `360` / `792` | 视口；省略时尝试从 `--image` PNG 推断 |
| `--html` / `--input` / `--image` | 自动发现 | 显式指定源文件路径 |
| `--stamp` | 时间戳 | 指定 `.run_skill/<stamp>` 目录名 |
| `--blueprint-session-dir` | — | 复用已有 blueprint session 目录 |

## 分阶段重跑

### 仅从 state model 起重跑（component-codegen + page-layer）

```bash
node taskflow-llm-pagegen/scripts/rerun_from_state_model.js \
  "/abs/path/to/case/.run_skill/20260623202602" \
  --width 360 --height 792
```

输出写入 `<runDir>/rerun_cgpl_<ts>/`。

### 单阶段命令（路径均可为绝对或相对 cwd）

**Preprocess**

```bash
node taskflow-llm-pagegen/sub-skills/preprocess/scripts/run_preprocess.js \
  "/abs/path/to/case" \
  --html "/abs/path/to/case/html/Index.original.html" \
  --out "/abs/path/to/case/.run_skill/<stamp>/preprocess" \
  --width 360 --height 792
```

**State implementation model**

```bash
node taskflow-llm-pagegen/sub-skills/code_gen2/sub-skills/state-implementation-model/scripts/run_skill.js \
  "/abs/path/to/case" \
  --blueprint "/abs/path/to/run/blueprint/stages/blueprint_builder_input.json" \
  --registry "/abs/path/to/run/preprocess/semantic_registry.json" \
  --out "/abs/path/to/run/state_implementation/state_implementation_model.llm.json" \
  --width 360 --height 792
```

**Component codegen**

```bash
node taskflow-llm-pagegen/sub-skills/code_gen2/sub-skills/component-codegen/scripts/run_skill.js \
  "/abs/path/to/case" \
  --state-model "/abs/path/to/run/state_implementation/state_implementation_model.llm.json" \
  --registry "/abs/path/to/run/preprocess/semantic_registry.json" \
  --out-dir "/abs/path/to/run/code_gen2_component_codegen" \
  --width 360 --height 792
```

**Page layer**（默认 rule-only + 无 auto-fit；需 LLM 占位层时加 `--llm`）

```bash
node taskflow-llm-pagegen/sub-skills/code_gen2/sub-skills/page-layer/scripts/run_skill.js \
  "/abs/path/to/case" \
  --html "/abs/path/to/run/preprocess/Index.preprocessed.html" \
  --registry "/abs/path/to/run/preprocess/semantic_registry.json" \
  --state-model "/abs/path/to/run/state_implementation/state_implementation_model.llm.json" \
  --blueprint "/abs/path/to/run/blueprint/stages/blueprint_builder_input.json" \
  --component-codegen "/abs/path/to/run/code_gen2_component_codegen/component_codegen.generated.json" \
  --out-dir "/abs/path/to/run/code_gen2_llm_layer_codegen" \
  --out-html "/abs/path/to/case/html/Index.state-model.code-gen2-layers.html" \
  --width 360 --height 792
```

## 流水线阶段说明

```
案例输入
  → 1. Preprocess（bbox + 语义标注 + semantic_registry）
  → 2. Blueprint（四阶段任务流蓝图，默认 auto）
  → 3. State Model（state_implementation_model.llm.json）
  → 4. Component Codegen（React → SSR HTML，递归子组件）
  → 5. Page Layer（占位层 + 注入组件 + Playwright 截图）
  → html/Index.state-model.code-gen2-layers.html
```

更细的 code_gen2 技术说明见 [`sub-skills/code_gen2/PIPELINE.md`](sub-skills/code_gen2/PIPELINE.md)。

## 依赖安装

在 **skill 根目录**安装运行时依赖（仅使用本目录 `node_modules`，不依赖上级工作区）：

```bash
cd taskflow-llm-pagegen
npm install
npx playwright install chromium
```

依赖：`playwright`、`react`、`react-dom`、`esbuild`（见 `package.json`）。

## 路径约定

- CLI 路径参数：**绝对路径**原样使用；**相对路径**相对**当前 shell 的 cwd** 解析。
- 编排器向子进程传递**绝对路径**，避免不同脚本 ROOT 不一致。
- 子 skill 的第一 positional 参数 `<caseDir>` 为案例根目录（含 `html/`）。

## 故障排查

| 现象 | 处理 |
|---|---|
| `Missing DASHSCOPE_API_KEY` | 确认 `<skill>/.env` 已配置 |
| `Missing dependency: playwright` | 在 skill 根目录执行 `npm install` |
| `Missing source HTML` | 案例目录需含 `html/Index.original.html` |
| blueprint `fetch failed` | 网络瞬时错误，重跑或换 stamp |
| 截图空白 | 查看 `code_gen2_llm_layer_codegen/auto_shots/state_layers_report.json` |

## 目录结构

```
taskflow-llm-pagegen/
  .env.example
  README.md                 ← 本文件
  SKILL.md                  ← Cursor Agent 简要说明
  scripts/
    run_skill.js            ← 全流程编排入口
    rerun_from_state_model.js
    paths.js                ← 路径 / env / NODE_PATH 公共模块
  sub-skills/
    preprocess/
    blueprint/
    code_gen2/              ← 默认 codegen 实现
```
