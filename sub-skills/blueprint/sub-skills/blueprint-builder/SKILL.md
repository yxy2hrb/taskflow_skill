---
name: taskflow-blueprint-builder
description: >
  任务流蓝图 Sub-skill 4：蓝图文件构建 Agent。
  汇总前 3 个子 Skill 的确认结果，组合成下一阶段输入。
  对应 taskflowIntentSkill.js Phase 4 (PHASE5_INSTRUCTION)。
---

# Sub-skill 4：蓝图文件构建 Agent

## 定位

蓝图生成最终步。当前阶段不调用 LLM，也不生成旧版 `blueprint.json`。脚本读取 Sub-skill 1–3 的 confirmed 结果，先生成 `phase4_preview.json` 供用户总览与编辑，确认后写入下一阶段输入文件。

## 输入

- `brief`：用户初始任务流描述
- `user_story_confirmed`：Sub-skill 1 产出的 User Story + platform，后处理会移除 `invest_check`
- `states_confirmed`：Sub-skill 2 用户确认保留的状态清单（含 `id / label / description`）
- `phase3_confirmed_by_id`：Sub-skill 3 为每个非 `state_1` 确认或单独修改后的实现方案
- `merged_states_by_id`：脚本按 `state_N` 将确认后的 state 与确认后的 implementation 合并后的对象
- `page_dsl`：页面 DSL

## 输出协议

### build：写入 `phase4_preview.json`

```json
{
  "action": "preview",
  "phase": 4,
  "brief": "用户原始 brief 原文",
  "user_story_confirmed": {},
  "merged_states_by_id": {
    "state_1": {
      "id": "state_1",
      "label": "...",
      "description": "...",
      "implementation": null
    },
    "state_2": {
      "id": "state_2",
      "label": "...",
      "description": "...",
      "implementation": {
        "implementation_plan": "..."
      }
    }
  },
  "page_dsl": {},
  "validation_issues": []
}
```

### confirm：写入 `blueprint_builder_input.json`

`blueprint_builder_input.json` 文件，作为下一阶段输入。当前不要求产出旧版 `blueprint.json`。

终端交互时，用户输入要保持原样的状态编号。脚本先展示完整合并蓝图；修改时输入自然语言
意见并调用模型重新生成完整内容，不得直接覆盖 `merged_states_by_id` 字段。

```json
{
  "action": "done",
  "phase": 4,
  "source_dir": "new_test/2",
  "brief": "...",
  "user_story_confirmed": {},
  "merged_states_by_id": {
    "state_1": {
      "id": "state_1",
      "label": "初始页面状态",
      "description": "触发条件：...\n展示信息：...\n继承信息：...",
      "implementation": null
    },
    "state_2": {
      "id": "state_2",
      "label": "创建项目集全屏页",
      "description": "触发条件：...\n展示信息：...\n继承信息：...",
      "implementation": {
        "implementation_plan": "确认后的具体实现方案，包含组件、形式、布局、文案和状态变化"
      }
    }
  },
  "page_dsl": {}
}
```

`blueprint_builder_input.json` 不包含全量 `implementation_options`，只保留确认后的合并结果。

## 字段规则

- `brief` 必须保留用户初始输入原文，不做摘要。
- `user_story_confirmed` 使用 Phase 1 结果，但必须移除 `invest_check`。
- `merged_states_by_id` 以 Phase 2 的 `id` 作为 key。
- `merged_states_by_id[state_N]` 包含 Phase 2 确认后的 `id / label / description`，并合入 Phase 3 确认后的 `implementation`。
- `implementation` 来自 Phase 3 confirmed；未修改状态使用生成草案，修改状态使用用户覆盖内容。
- 后处理必须移除 `basis`、`rationale`、`group`、`default`、`implementation.id`、`implementation.label` 等中间决策字段。
- 后处理后的 `implementation` 只保留 `implementation_plan` 等下一阶段执行所需字段。
- `state_1` 的 `implementation` 必须为 `null`。
- `page_dsl` 保留原始页面 DSL 内容，用于下一阶段继续理解页面结构。

## 校验清单（写入前自检）

- [ ] `brief / user_story_confirmed / merged_states_by_id / page_dsl` 齐全
- [ ] 输出不包含 `invest_check`
- [ ] 输出不包含 `basis / rationale / group / default / implementation.id / implementation.label`
- [ ] `merged_states_by_id.state_1.implementation === null`
- [ ] 每个非 `state_1` 都有选定 `implementation`
- [ ] Phase 2 的每个 state 一一对应出现，禁止合并/省略
- [ ] 不在此阶段生成旧版 `blueprint.states`

## 落盘

组合输入写入路径：`{caseDir}/.run_skill/{stamp}/blueprint/stages/blueprint_builder_input.json`。

## 辅助脚本

可使用 `sub-skills/blueprint/scripts/run_skill.js` 将前 3 个子 Skill 的选择结果组合为 Sub-skill 4 的输入：

```bash
node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js generate \
  --session-dir new_test/2/.run_skill/{stamp}/blueprint \
  --phase 4
```

脚本读取：

- `phase1_confirmed.json`
- `phase2_confirmed.json`
- `phase3_confirmed_by_id.json`
- `spec.json` 或 `page_dsl.json`

输出：

- `phase4_preview.json`
- `blueprint_builder_input.json`

## 代码参考

`backend/src/prompts/taskflowIntentSkill.js` → `PHASE5_INSTRUCTION`
`backend/src/taskflowOneClick.js` → `validateBlueprint()` / `blueprintToTaskflowArray()`
