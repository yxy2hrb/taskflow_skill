---
name: taskflow-blueprint
description: >
  任务流蓝图生成顶层 Skill。输入任务流描述和页面 DSL，通过 4 个可确认阶段生成
  blueprint_builder_input.json。默认 interactive，支持 checkpoint 恢复与 auto 批量模式。
---

# 任务流蓝图生成（Interactive）

## 目标

将自然语言任务流描述和初始页面 DSL 转换为下一阶段代码生成使用的
`blueprint_builder_input.json`。蓝图阶段默认不再一口气连跑 4 步，而是每步：

```text
generate 结构化草案 -> Phase 1/2/4 选择保留编号，Phase 3 直接展示完整方案
-> 模型按修改意见重新生成完整内容（可多轮） -> 用户确认 -> 写入 confirmed -> 下一步
```

最终产物仍是：

```text
{caseDir}/.run_skill/{stamp}/blueprint/stages/blueprint_builder_input.json
```

## Session 目录

每次蓝图运行使用单一 session 目录：

```text
{caseDir}/.run_skill/{stamp}/blueprint/
  session.json
  stages/
    phase1_ask.json
    phase1_confirmed.json
    phase2_ask.json
    phase2_confirmed.json
    phase3_ask.json
    phase3_confirmed_by_id.json
    phase4_preview.json
    blueprint_builder_input.json
  logs/
    phase1_raw.json
    phase2_raw.json
    phase3_raw.json
  validation/
    phase1_report.json
    phase2_report.json
    phase3_report.json
    phase4_report.json
```

`session.json.status` 取值：`idle | generating | awaiting_confirm | confirmed | completed | failed`。

## CLI

```bash
node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js init \
  --dirs new_test/2 \
  --model qwen3.7-max

node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js generate \
  --session-dir new_test/2/.run_skill/{stamp}/blueprint \
  --phase 1

node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js confirm \
  --session-dir new_test/2/.run_skill/{stamp}/blueprint \
  --phase 1

node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js resume \
  --session-dir new_test/2/.run_skill/{stamp}/blueprint

node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js status \
  --session-dir new_test/2/.run_skill/{stamp}/blueprint

node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js auto \
  --dirs new_test/2 \
  --model qwen3.7-max
```

旧 `--skill taskflow-user-story` 参数已废弃；使用 `generate/confirm --phase N`。

## 用户输入

`confirm` 默认进入纯文本交互。Phase 1、2、4 先选择编号：

```text
请输入要保留的编号：
> 1,2,3,4

--- 根据所选编号生成的完整内容 ---
...

请输入修改意见：
> 第三个状态增加加载反馈，并禁止重复提交

--- 模型修改后的完整内容 ---
...

请输入修改意见：
> next
```

- Phase 1：四个分组各选择一个编号。
- Phase 2：编号表示保留的 state。
- Phase 3：不选择编号，直接展示完整 UI 实现方案；用户输入自然语言修改意见或 `next`。
- Phase 4：编号表示保持原样的合并状态；修改意见作用于完整蓝图。
- 每轮修改意见都会调用模型重新生成并校验完整内容，不直接修改 confirmed 文件。
- 输入 `next`、`done` 或 `下一步` 完成当前 Phase。
- `--input feedback.txt` 在 Phase 1、2、4 使用第一行编号；Phase 3 从第一行开始读取修改意见。
- 原有 `--input feedback.json` 继续兼容。

## 阶段状态机

```text
Phase 1 generate -> phase1_ask.json
Phase 1 confirm  -> phase1_confirmed.json
Phase 2 generate -> phase2_ask.json
Phase 2 confirm  -> phase2_confirmed.json
Phase 3 generate -> phase3_ask.json
Phase 3 confirm  -> phase3_confirmed_by_id.json
Phase 4 build    -> phase4_preview.json
Phase 4 confirm  -> blueprint_builder_input.json
```

`resume` 规则：

- `idle`：自动生成当前 phase 的 ask/preview。
- `awaiting_confirm`：只展示当前待确认视图，不自动确认。
- `completed`：输出最终文件路径。

## 输出契约

### Phase 1

`phase1_ask.json` 是四维度选项视图：Actor、Trigger、Goal & Happy Path、Success Criteria。
用户确认后生成 `phase1_confirmed.json`，包含：

- `selections`
- `actor/context/trigger/happy_path/goal/benefit/success_criteria`
- `acceptance_criteria_steps`
- `user_story`
- `platform`

### Phase 2

`phase2_ask.json` 是状态清单勾选视图。确认后写 `phase2_confirmed.json`：

- 只保留用户勾选或编辑后的 state。
- `state_1` 不可删除。
- `states.length >= 4`。
- confirmed 中移除 Phase 2 的 `basis` 中间参考字段。

### Phase 3

`phase3_ask.json` 为每个非 `state_1` 生成一份 UI 实现草案。CLI 直接将全部草案组成完整实现
方案展示给用户，不要求选择编号。用户的自然语言修改意见由模型作用于完整内容。确认后仍写：

```json
{
  "action": "confirmed",
  "phase": 3,
  "selections_by_state": {
    "state_2": {
      "option_id": "state_2::implementation",
      "implementation_plan": "..."
    }
  }
}
```

未修改的 state 沿用生成草案；被模型修改的 state 使用重新生成的 `implementation_plan`，
并将 `option_id` 记为 `custom`。

### Phase 4

Phase 4 初始预览不调用 LLM。脚本读取前三步 confirmed，生成 `phase4_preview.json`。
若用户提出修改意见，则调用模型基于完整预览重新生成；用户确认后写入
`blueprint_builder_input.json`。

## 质量门禁

- Phase 1 ask 四个 group 都存在，每组有且仅有一个 default。
- Phase 1 confirmed 包含完整 User Story 和顺序 BDD steps。
- Phase 2 confirmed 保留 `state_1`，状态数不少于 4，description 包含三段。
- Phase 2 ask 每个 state 包含简短 `basis`，展示为“依据”。
- Phase 3 ask 不包含 `state_1`，每个非初始 state 有且仅有一份实现草案。
- Phase 3 ask 每份实现草案包含简短 `basis`，展示为“依据”。
- Phase 3 confirmed 每个非 `state_1` 都有最终 `implementation_plan`。
- Phase 4 输出含 `brief / user_story_confirmed / merged_states_by_id / page_dsl`。
- `merged_states_by_id.state_1.implementation === null`。
- 每个非 `state_1` 都有 `implementation.implementation_plan`。

## 子 Skill

- `user-story`：生成 Phase 1 ask；confirm 时合成 confirmed。
- `state-enumeration`：生成 Phase 2 ask；confirm 时写状态清单。
- `implementation-plan`：为每个状态生成一份实现草案；直接展示完整方案，confirm 时通过模型修改并写 `selections_by_state`。
- `blueprint-builder`：构建 Phase 4 preview；修改时调用模型重生成完整蓝图，confirm 后写最终输入。
