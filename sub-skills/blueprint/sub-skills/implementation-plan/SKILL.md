---
name: taskflow-implementation-plan
description: >
  任务流蓝图 Sub-skill 3：实现方案具体生成 Agent。
  为每个非 state_1 的 happy-path state 提供 1 个完整 UI 实现草案，组成完整方案供用户确认或修改。
  对应 taskflowIntentSkill.js Phase 3。
---

# Sub-skill 3：实现方案具体生成 Agent

## 定位

蓝图生成第三步。对 Sub-skill 2 确认的状态清单中每个非 state_1 的 state，生成 1 个完整 UI
实现草案。CLI 直接将全部草案组成完整方案展示，不进行编号选择；用户可以直接接受，也可以
通过自然语言意见修改完整方案。

## 输入

- `confirmed_states`：Sub-skill 2 用户确认保留的状态清单（含 `id / label / description`）
- `user_story`：Sub-skill 1 确认的 User Story
- `page_dsl`：页面 DSL（辅助判断设计语言/组件库）

## 输出协议

Phase 3 拆成 `generate` 与 `confirm` 两步。

### generate：写入 `phase3_ask.json`

按 state 分组生成唯一实现草案。每个非 `state_1` 只对应一条 option，CLI 将所有 option 直接组成
完整实现方案展示，不进行编号选择；用户确认或修改后传入 Sub-skill 4。

每个实现草案必须输出 `implementation_plan`，不是 `label`。`implementation_plan` 是服务后续代码生成的具体实现说明，应写清楚组件、形式、布局、文案、继承关系和状态变化，而不是一句短标签。

实现草案必须参考 Phase 2 的 `description` 三段：

- `触发条件` 用于判断该 state 的主要用户意图
- `展示信息` 用于决定当前画面需要哪些组件、文案和布局
- `继承信息` 用于决定应保留哪些视觉骨架，以及候选方案中哪些内容是新增或变化的

## 核心规则

### Material Design 意图 → 组件映射参考

生成每个 state 的唯一实现草案时，优先参考 Google Material Design / Material 3 的组件职责：实现方案应从用户意图反推组件，而不是先套固定页面模板。

### Material Design Intent-to-Implementation Rules

### Action Intent

- If the user needs to perform the primary page action, use a filled button or FAB.
- If the action is secondary, use an outlined button or text button.
- If the action is compact and placed in a toolbar, use an icon button.
- If the action reveals several choices, use a menu.
- If the action result is reversible and lightweight, use a snackbar with an action.

### Selection Intent

- If the user can select multiple independent options, use checkboxes.
- If the user must select exactly one option from a small set, use radio buttons.
- If the user turns a setting on or off and the change applies immediately, use a switch.
- If the user selects a numeric value from a range, use a slider.
- If the user switches between a small number of views or sort modes, use segmented buttons.
- If the user filters content, use filter chips.
- If the user enters compact tokens, use input chips.

### Text Input Intent

- If the user inputs a name, title, or short text, use a text field.
- If the user inputs long-form content, use a multiline text field.
- If the user searches product content, use a search bar or search view.
- If the user selects a date, use a date picker.
- If the user selects a time, use a time picker.

### Navigation Intent

- If the user switches between top-level views on a small screen, use a navigation bar.
- If the user switches between top-level views on a medium or large screen, use a navigation rail.
- If the app has many destinations or hierarchy, use a navigation drawer.
- If the screen needs title, back navigation, and actions, use a top app bar.
- If the user switches between sibling content sections, use tabs.

### Feedback Intent

- If the system provides short non-blocking feedback, use a snackbar.
- If the user must act on important information, use a dialog.
- If the system is processing, use a progress indicator.
- If the UI needs to show notification count or status, use a badge.
- If the user needs contextual help, use a tooltip.

### Containment Intent

- If the UI presents one subject with related actions, use a card.
- If the UI presents many similar items vertically, use a list.
- If the UI presents secondary content from the bottom, use a bottom sheet.
- If the UI needs subtle grouping, use a divider.

方案生成规则：

- 每个 state 的唯一方案必须贴合该 state 的主要用户意图；例如“单选公司/个人属性”应明确 Radio buttons 或 Segmented buttons，而不是只写“表单页面”。
- Switch 只用于“开启/关闭且立即生效”的布尔设置；不要把 Switch 用于“公司/个人、类型 A/类型 B”这类语义分类二选一。
- 若是严格单选，不要使用会暗示多选或 token 输入的 Chips；只有“筛选标签 / 多选标签 / 已输入 token”场景才使用 Filter chips / Input chips。
- 若 state 同时包含多个意图，按视觉主次组合组件：页面容器（Full-screen page）+ 输入（Text field）+ 选择（Radio/Segmented buttons/Chips）+ 主按钮（Button）。
- 成功终态优先使用 Snackbar / Toast，除非 brief 明确要求进入成功页或展示完成详情。
- 提交中态优先描述 Button loading 或 Progress indicator；只有等待画面本身可见且重要时才单独作为 state。
- 实现方案中不要写“使用 Material 组件库实现”这类技术绑定；只描述组件形态、位置、文案和可见状态。

### 描述以稳定画面为主，允许必要动效说明

实现方案需要优先说明 state 的稳定画面：屏幕上有什么、在哪个区域、文案是什么、关键组件如何组织。

`implementation_plan` 必须包含以下信息：

- 组件：使用哪些可见组件或控件形态，例如全屏页、Top app bar、Text field、Radio buttons、Segmented buttons、List、Button、Snackbar、Progress indicator。
- 形式：组件呈现方式和状态，例如输入框为空/已填写、单选项选中态、按钮默认/禁用/loading、Toast/Snackbar 出现位置。
- 布局：组件位于页面哪个区域，以及从上到下/从内到外的排列关系。
- 文案：关键标题、按钮、提示、占位符、成功反馈等可见文本。
- 继承/变化：相对 Phase 2 `description.继承信息` 中提到的来源 state，哪些骨架保留，哪些区域替换或新增。

允许补充必要的动画/过渡过程描述，例如：

- "底部抽屉从下方滑入，最终停在屏幕底部 50vh，列出说明 + 两个按钮"
- "顶部 Toast 显示在状态栏下方 16px，短暂停留后淡出"
- "提交后按钮进入 loading 态，随后展示成功提示"

注意：动效只能作为补充，不得替代 state 的画面结构、字段文案和组件布局。

### 取消/关闭/返回类状态

蓝图默认只覆盖 happy-path，不主动为取消/关闭/返回单独建 state。若 brief 明确要求将取消/返回作为主路径一部分，可描述其最终画面和必要动效。

### 实现 ID 与分组格式

```json
{
  "id": "state_2::implementation",
  "implementation_plan": "采用全屏表单页承载创建项目集流程。保留 state_1 的顶部状态栏，主体区域替换为创建项目集表单：顶部放置页面标题“创建项目集”和返回入口；中部从上到下排列项目集名称 Text field（占位符“请输入项目集名称”）、属性单选 Radio buttons（选项“公司”“个人”，默认未选或按业务默认选中）、添加项目 List/入口卡片（文案“添加项目”）；底部固定红色主按钮“确认”。该方案适合字段较多且需要清晰提交路径的状态。",
  "basis": "参考 Apple 设置页的清晰分组与淘宝表单页的底部主操作设计。",
  "group": "state_2 · 示例状态"
}
```

- `id` 格式固定为：`state_N::implementation`
- `implementation_plan` 是实现方案正文，必须是可执行的 UI 实现描述，不得写成短标签
- `basis` 是简短设计依据，说明参考的知名产品设计思路或典型相关页面
- `group` 格式：`state_N · {state_name}`
- 每个非 `state_1` 必须且只能输出 **1 个** option
- 不输出 `default` 字段
- 实现文案必须贴合当前 `brief` 和 state 名称，禁止照抄示例里的"风险说明"、"下载"等无关业务词
- 禁止用 `label` 代替 `implementation_plan`

## LLM 输出协议

```json
{
  "action": "ask",
  "phase": 3,
  "questionText": "以下是完整 UI 实现方案，请直接确认或提出修改意见。",
  "options": [ ... ],
  "multiSelect": false,
  "allowCustom": true,
  "note": "无需选择编号；修改意见会作用于完整实现方案。"
}
```

总 options 数 = 非 `state_1` 的 state 数量。

### confirm：写入 `phase3_confirmed_by_id.json`

```json
{
  "action": "confirmed",
  "phase": 3,
  "selections_by_state": {
    "state_2": {
      "option_id": "state_2::implementation",
      "implementation_plan": "确认后的完整实现说明..."
    },
    "state_3": {
      "option_id": "custom",
      "implementation_plan": "用户自定义方案..."
    }
  }
}
```

confirm 规则：

- 执行 confirm 即表示接受所有未修改的实现草案。
- 终端交互直接展示所有 state 的完整实现方案，不要求用户选择数字编号。
- 用户直接输入自然语言修改意见；输入 `next`、`done` 或 `下一步` 确认并进入 Phase 4。
- 每轮修改必须调用模型重新生成完整实现方案，不得直接覆盖 `implementation_plan`。
- 未修改 state 的 `option_id` 保留 `state_N::implementation`；修改后的 state 记为 `custom`。
- 每个非 `state_1` 的 state 最终必须有且仅有一条实现方案。
- `state_1` 不出现在 options 和 `selections_by_state` 中。

## 约束

- 每条 `basis` 由模型生成，用一句话说明参考对象及可借鉴的设计思路。
- 可参考 Apple、淘宝、Google、微信、Amazon、京东、支付宝等知名产品或设计体系，但不限于这些。
- 依据应贴合当前 state 的页面类型，例如商品详情、购物车确认、表单编辑、加载反馈或成功结果页。
- 内容保持简短，不展开品牌历史或复杂设计分析，不只罗列品牌名称。
- 使用字段名 `basis`，不要输出 `rationale`。
- 每条 option 必须包含 `id / implementation_plan / basis / group`
- `implementation_plan` 建议 80–180 字，必须包含组件、形式、布局和关键文案
- `implementation_plan` 不能只写“全屏页面：...”这类一句话摘要
- 禁止 state_1 出现在 options 中（初始态即原始页面，不改造）
- 输出严格 JSON，禁止 Markdown 包裹
