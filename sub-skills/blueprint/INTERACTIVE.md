# Blueprint 编号交互操作手册

## 运行原则

蓝图阶段默认使用纯文本交互：

1. `generate --phase N` 生成 ask 或 preview。
2. Phase 1、2、4 使用编号选择；Phase 3 直接展示完整实现方案。
3. Phase 3 用户无需选择编号，可直接确认或输入自然语言修改意见。
4. 需要编号的 Phase 根据所选编号合成并展示完整内容。
5. 用户输入自然语言修改意见后，脚本调用模型重新生成完整内容并再次展示。
6. 用户可继续输入修改意见；输入 `next`、`done` 或 `下一步` 后才写入 confirmed 并进入下一 Phase。

修改意见不会直接覆盖 confirmed 文件。原 JSON 输入仍作为兼容接口保留。

## 基本命令

```bash
node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js confirm \
  --session-dir new_test/2/.run_skill/{stamp}/blueprint \
  --phase 1
```

执行后会显示编号视图并进入交互输入。

## Phase 1

四个分组中的选项使用全局连续编号。每组必须选择一个：

```text
① Actor
[1] 已登录用户
[2] 首次访问用户

② Trigger
[3] 点击创建按钮
[4] 从列表菜单进入

③ Goal & Happy Path
[5] ...
[6] ...

④ Success Criteria
[7] ...
[8] ...

请输入四个选项编号：
> 1,3,5,7
```

修改完整内容：

```text
--- 根据所选编号生成的完整内容 ---
Phase 1 完整 User Story
...

请输入修改意见：
> 主路径中增加确认弹窗，并补充取消后的返回行为

--- 模型修改后的完整内容 ---
Phase 1 完整 User Story
...

请输入修改意见：
> next
```

## Phase 2

输入要保留的状态编号：

```text
请输入要保留的状态编号：
> 1,2,3,5
```

`state_1` 必须保留，确认后的状态数量仍需不少于 4。

每个候选 state 会显示一条简短“依据”，说明参考的知名产品设计模式或典型相关页面，例如
Apple Store 商品详情页、淘宝购物车、美团半模态清单等。

选择后会先展示完整状态序列。修改时直接描述整体意见：

```text
> 将 state_3 改为“已填写可提交状态”，并明确按钮从禁用变为可点击
```

模型必须返回完整状态序列。用户可以继续要求新增、删除或调整状态顺序；系统会重新生成连续的
`state_1...state_N`，并同步更新状态引用。

## Phase 3

每个非初始状态只有一份 UI 实现方案。进入 Phase 3 后直接展示全部状态的完整实现方案：

```text
--- 模型生成的完整实现方案 ---

Phase 3 完整实现方案

state_2
...
依据：参考相关知名产品的典型页面或设计模式。

state_3
...

请输入修改意见；输入 next/done/下一步，确认当前内容并进入下一 Phase：
> state_3 保留上一状态的顶部导航和主体骨架，在底部按钮区域显示 loading，并禁用重复提交
```

系统根据意见调用模型重新生成完整实现方案并再次展示。用户可以继续修改；输入 `next`、
`done` 或 `下一步` 后写入 confirmed 并进入 Phase 4。

模型返回完整 `selections_by_state`；发生变化的方案在 confirmed 中记为 `custom`。
“依据”仅用于用户评审，不写入 Phase 3 confirmed 和最终蓝图。

## Phase 4

输入要保持原样的状态编号，直接回车表示全部保留。

修改合并蓝图：

```text
> state_3 的弹窗高度改为半屏，其他状态保持不变
```

模型返回完整蓝图，可新增、删除或调整状态顺序。系统会重新生成连续 state id；新增的非初始
状态必须同时包含完整 implementation，并保留来源信息和 `state_1.implementation = null`。

## 编号文本文件

需要非交互执行时，可以使用简单文本文件，不必写 JSON。

Phase 1、2、4 的第一行是保留编号，后续每行是一轮自然语言修改意见：

```text
1,2,3,4
将 state_3 改为加载状态，并禁止重复提交
成功状态增加结果摘要
```

兼容旧的 `编号=内容` 写法，但该行会被转换为“重点修改对应编号”的模型意见，不会直接覆盖字段。

执行：

```bash
node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js confirm \
  --session-dir new_test/2/.run_skill/{stamp}/blueprint \
  --phase 3 \
  --input feedback.txt
```

Phase 3 文本文件不需要编号，第一行开始就是修改意见：

```text
state_3 的底部按钮增加 loading，并禁止重复提交
next
```

如无修改，Phase 3 文本文件只写 `next`。Phase 4 全部保留时第一行仍可写 `all`。
旧 Phase 3 文件首行遗留的 `all` 或编号会被忽略。

## JSON 兼容

已有的 `feedback.json` 无需修改，CLI 会先尝试按 JSON 解析；不是 JSON 时才按编号文本解析。

## Auto 模式

```bash
node .cursor/skills/taskflow-llm-pagegen/sub-skills/blueprint/scripts/run_skill.js auto \
  --dirs new_test/2 \
  --model qwen3.7-max
```

auto 模式不进入终端编号交互，行为保持不变。
