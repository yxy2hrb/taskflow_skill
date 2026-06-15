---
name: taskflow-user-story
description: >
  任务流蓝图 Sub-skill 1：User Story 构建梳理 Agent。
  输入任务流简述和页面 DSL，通过四维度澄清生成一句话 User Story。
  对应 taskflowIntentSkill.js Phase 1。
---

# Sub-skill 1：User Story 构建梳理 Agent

## 定位

蓝图生成第一步。将用户的一句话任务流描述，展开为「Actor / Trigger / Happy Path / Goal / Success Criteria / Acceptance Criteria」等结构化信息，确认后合成为一句完整但不丢信息的 User Story。

本 Skill 参考 `extend_skills/user_story_generator` 的 User Story 范式、INVEST、Given-When-Then / BDD 验收标准与质量清单，但面向任务流蓝图生成做收敛：默认只生成 happy-path 主线，不主动展开失败态、取消态或重试态。

## 输入

- `brief`：任务流简要描述
- `page_dsl`：页面结构 DSL（用于判断平台类型 mobile/desktop）

## 输出协议

Phase 1 拆成 `generate` 和 `confirm` 两步。

### generate：写入 `phase1_ask.json`

LLM 只返回四维度候选，不直接返回 confirmed：

```json
{
  "action": "ask",
  "phase": 1,
  "questionText": "请从下面四个维度各选一项，我会合成完整 User Story。",
  "multiSelect": true,
  "allowCustom": true,
  "note": "四个维度各选一项；也可在补充栏直接写覆盖内容。",
  "options": [
    {
      "id": "actor_1",
      "group": "① Actor · 主角",
      "label": "已登录的普通用户",
      "rationale": "与页面已有入口和权限假设最匹配",
      "default": true
    }
  ]
}
```

四个 group 必须齐全：

- `① Actor · 主角`
- `② Trigger · 触发点`
- `③ Goal & Happy Path · 核心目标与理想路径`
- `④ Success Criteria · 成功判定`

每组 2-4 个候选，成功判定组 2-3 个候选；每组有且仅有一个 `default: true`。

### confirm：写入 `phase1_confirmed.json`

用户可以提交选项 ID，也可以直接提交完整 confirmed JSON。脚本根据四维度选择合成：

终端交互时，四组候选使用连续数字编号；用户只需每组输入一个编号。脚本先将四项选择
合成为完整 User Story 并展示。若用户提出自然语言修改意见，必须调用模型基于完整内容
重新生成，不得把用户文本直接覆盖到 confirmed 字段。

### User Story 范式

标准格式：

```text
作为 <Actor>，当 <Trigger> 时，我希望能 <Goal/Happy Path>，以便 <Benefit/Value>，直到 <Success Criteria> 为止。
```

若页面上下文重要，使用扩展格式：

```text
作为 <Actor>，在 <Context / 当前页面或场景> 中，当 <Trigger> 时，我希望能 <Goal/Happy Path>，以便 <Benefit/Value>，直到 <Success Criteria> 为止。
```

任务流蓝图中的推荐格式：

```text
"作为 <Actor>，当 <Trigger> 时，我希望能 <Goal/Happy Path>，直到 <Success Criteria> 为止。"
```

输出必须包含 `platform: "mobile" | "desktop"` 判断结果。

`Goal/Happy Path` 必须尽量完整展开用户输入里的主路径，不要压缩成“填写信息并提交成功”这类泛化短句。应在用户原始描述基础上补足为连续路径，保留触发后的关键页面、布局保留项、输入项、选择项、校验条件、提交动作和成功反馈。

### 输出 JSON 结构

最终确认结果必须写成对象，至少包含：

```json
{
  "actor": "...",
  "context": "...",
  "trigger": "...",
  "happy_path": "...",
  "goal": "...",
  "benefit": "...",
  "success_criteria": "...",
  "acceptance_criteria_steps": [
        { "type": "given", "text": "..." },
        { "type": "and", "text": "..." },
        { "type": "when", "text": "..." },
        { "type": "then", "text": "..." },
        { "type": "and", "text": "..." }
  ],
  "invest_check": {
    "independent": "...",
    "negotiable": "...",
    "valuable": "...",
    "estimable": "...",
    "small": "...",
    "testable": "..."
  },
  "user_story": "作为...，当...时，我希望能...，直到...为止。",
  "platform": "mobile"
}
```

`acceptance_criteria_steps` 是 phase1 的测试化约束，供后续状态枚举和蓝图校验参考；它不要求生成失败态，只要求把 happy path 的前置条件、动作和端点结果描述清楚。

`acceptance_criteria_steps[]` 必须是**顺序数组**，不要把 Given / When / Then / And 分别放进独立数组。BDD 步骤本身有时间顺序，同一个场景中可能出现多轮 `When → Then → When → Then`，必须按原始顺序逐条保留。

硬性格式要求：

- `acceptance_criteria_steps` 必须是 JSON array，不得是 string
- `acceptance_criteria_steps` 的每一项必须是 object：`{ "type": "given|and|when|then|but", "text": "..." }`
- 禁止把多个步骤拼成一个字符串，例如禁止：`"steps": "{\"type\":\"given\"...},{\"type\":\"when\"...}"`
- 禁止输出 `steps_text`、`gherkin`、`given/when/then/and` 分桶字段替代 `steps`

## 四维度澄清规则

### 维度 1：Actor · 主角（group="① Actor · 主角"）
- 2–4 个候选，每条 6–14 字，精准可区分
- rationale 说明典型特征（如"有未同步数据的老用户"）
- 示例：已登录的普通用户 / 首次访问的游客 / 内容创作者本人

### 维度 2：Trigger · 触发点（group="② Trigger · 触发点"）
- 2–4 个候选；rationale 说明入口前置条件
- 示例：在详情页点击下载按钮 / 在列表长按后选择"保存"

### 维度 3：Goal & Happy Path · 核心目标（group="③ Goal & Happy Path · 核心目标与理想路径"）
- 候选用三段式：`<主要诉求> → <系统关键决策> → <用户确认/完成动作>`
- 2–4 条；rationale 对比与其他候选的差异（禁止使用评分/cost等词）
- 示例："把视频保存到本地 → 系统识别蜂窝网络并提示风险 → 用户确认后等待下载完成"
- 必须覆盖 brief 中所有 happy-path 业务信息；例如 brief 提到“进入全屏页、保留状态栏与底Tab、填写名称、单选公司/个人、添加符合属性的项目、点击底部红色确认、名称非空且属性与项目一致、顶部成功提示”，这些信息都要进入 happy path，不能合并成“填写项目集信息并提交”。
- Happy Path 应以用户可见路径表达，格式建议为：`进入/打开目标界面 → 保留/变化的页面结构 → 填写/选择/添加内容 → 系统校验或业务规则 → 用户提交 → 成功反馈`。

### 维度 4：Success Criteria · 成功判定（group="④ Success Criteria · 成功判定"）
- 必须从「端点状态」描述，不要只写"成功了"
- 2–3 条；rationale 说明边界情况
- 示例："原下载按钮变为'已下载'状态且文件可离线播放"

## Acceptance Criteria Steps (Given-When-Then / BDD)

### 格式

```gherkin
Scenario: [描述性场景名]
  Given [前置条件 / 初始状态]
  And [必要的额外前置条件]
  When [用户触发动作]
  And [happy path 中的连续动作]
  Then [可见结果 / 可验证断言]
  And [额外成功断言]
```

对应 JSON 必须保留顺序：

```json
[
  { "type": "given", "text": "前置条件 / 初始状态" },
  { "type": "and", "text": "必要的额外前置条件" },
  { "type": "when", "text": "用户触发动作" },
  { "type": "and", "text": "happy path 中的连续动作" },
  { "type": "then", "text": "可见结果 / 可验证断言" },
  { "type": "and", "text": "额外成功断言" }
]
```

### 任务流示例

```gherkin
Feature: 创建项目集
    Given 用户已登录并停留在“我的工作台”页面
    And 页面中存在“创建项目集”入口
    When 用户点击“创建项目集”按钮
    Then 系统进入创建项目集全屏页
    When 用户填写项目集名称
    And 用户在“公司”和“个人”属性中单选其一
    And 用户添加符合所选属性的项目
    And 用户点击底部红色“确认”按钮
    Then 若名称非空且属性与项目一致，页面顶部弹出创建成功提示
```

对应 JSON 示例：

```json
[
  { "type": "given", "text": "用户已登录并停留在“我的工作台”页面" },
  { "type": "and", "text": "页面中存在“创建项目集”入口" },
  { "type": "when", "text": "用户点击“创建项目集”按钮" },
  { "type": "then", "text": "系统进入创建项目集全屏页" },
  { "type": "when", "text": "用户填写项目集名称" },
  { "type": "and", "text": "用户在“公司”和“个人”属性中单选其一" },
  { "type": "and", "text": "用户添加符合所选属性的项目" },
  { "type": "and", "text": "用户点击底部红色“确认”按钮" },
  { "type": "then", "text": "若名称非空且属性与项目一致，页面顶部弹出创建成功提示" }
]
```

### Acceptance Criteria 反模式

| 反模式 | 问题 | 正确做法 |
| --- | --- | --- |
| “应该能正常使用” | 不可验证 | 写清可见结果，如“顶部弹出成功提示” |
| 只写实现方案 | 限制后续实现 | 写用户行为和可见状态，不写数据库或框架细节 |
| 丢失输入信息 | 后续状态枚举缺上下文 | brief 中出现的输入项、选择项、校验项必须进入 Given/When/Then |
| 成功判定重复 | user_story 冗余 | success_criteria 与 user_story 只表达一次端点状态 |
| 默认展开失败态 | 偏离 happy-path | 仅当 brief 明确把失败处理作为主目标时才写失败场景 |

## 约束

- 输出必须符合 INVEST 中与 phase1 相关的约束：
  - Independent：能独立描述一个完整任务流，不依赖其它 story 才能理解
  - Negotiable：描述用户目标和可见行为，不绑定具体技术实现
  - Valuable：能说明用户为什么要完成该任务流
  - Estimable：边界清晰，可供后续拆 state
  - Small：只覆盖当前 brief 的主 happy-path，不扩展多个无关流程
  - Testable：包含 Given-When-Then 式验收标准
- `happy_path` 必须覆盖 brief 中的关键名词、用户输入、选择项、校验条件、按钮文案和成功反馈；不得简写为“填写信息并提交成功”
- `acceptance_criteria_steps` 必须是一个顺序数组，至少包含 1 条 happy-path BDD 链路
- `acceptance_criteria_steps[].type` 只能是 `given | when | then | and | but`，全部小写；`text` 写具体可验证行为或结果
- `acceptance_criteria_steps` 中必须至少包含一个 `given`、一个 `when`、一个 `then`；允许多个 `when/then` 交替出现，必须按真实任务流顺序排列
- 禁止输出 `given: [] / when: [] / then: [] / and: []` 这种分桶结构
- `user_story` 不得重复 success criteria；例如不要写“直到顶部弹出成功提示，顶部弹出成功提示为止”
- 禁止默认生成失败、取消、重试、返回场景；只在用户目标明确要求时才写入
- 禁止 Markdown 包裹、禁止 `<think>` 标签
- 输出严格 JSON，无自然语言解释

## confirm 规则

- `selections.actor / trigger / happy_path / success_criteria` 必须各有一项。
- `custom_overrides` 可覆盖任一维度文本。
- `acceptance_criteria_steps` 缺省时由脚本根据四维度合成，但用户可提供完整顺序数组。
- confirmed 结果必须保留 `action: "confirmed"` 和 `phase: 1`。

## Story Quality Checklist

写出 phase1 前自检：

- [ ] Story follows “作为...当...我希望...直到...” format
- [ ] Happy path 覆盖 brief 的全部主线信息
- [ ] Acceptance criteria written in Given-When-Then
- [ ] No technical jargon that constrains implementation
- [ ] No vague phrases such as “正常使用 / 填写信息 / 操作成功”
- [ ] No duplicate success wording
- [ ] No non-happy-path states unless explicitly required by user
