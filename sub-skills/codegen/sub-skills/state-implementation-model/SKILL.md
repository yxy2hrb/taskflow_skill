---
name: taskflow-state-implementation-model-llm
description: Generate taskflow state implementation model from blueprint and semantic registry.
---

# State Implementation Model LLM

## Goal

Use the LLM, not scripted heuristics, to convert confirmed blueprint states,
semantic registry, anchor bbox information, and page context into a
machine-readable state implementation model.

The output is only the state model. Do not repeat semantic anchors,
semantic_registry, or full HTML in the output. The runner joins registry data
before the next stage.

## Inputs

- `blueprint_builder_input.json`
- `semantic_registry`, keyed by anchor name, with selector, semantic text,
  visible text, area, policy, and bbox
- `anchor_bboxes`, keyed by anchor name
- `layout_constraints`
- viewport:
  - `width` is fixed and must not be changed.
  - `initial_height` is the original capture viewport height.
  - If a single generated page contains more content than the original viewport can fit, the generated page may be taller than `initial_height`.
  - Do not widen the page.

## Output

Return strict JSON only:

```json
{
  "states": [
    {
      "id": "state_1",
      "label": "internal state label from blueprint",
      "ui_intent": "what the user should see",
      "parent_state": null,
      "trigger": null,
      "inheritance": {
        "keep": [],
        "create": [],
        "update": []
      },
      "data_state": {},
      "patches": []
    }
  ],
  "validation_notes": []
}
```

## Strict Shape

- `inheritance.keep` must be an array of anchor/component ids.
- `inheritance.create` must be an array of create patch objects, not strings.
- `inheritance.update` must be an array of update patch objects, not strings.
- Do not output `inheritance.hide`.
- Do not output `inheritance.replace`.
- Do not output hide or replace patches.
- `patches` is only for explicit interaction bindings when needed, especially
  `bind` patches.
- A create patch must include `type: "create"`, `id`, `component`, `bbox` or
  layout constraints, visible text fields when applicable, and optional `mount`.
- A later state may `keep` or `update` a virtual component id created by an
  earlier state. Do not reference a virtual id before it has been created.

## Anchor Namespaces

There are two valid anchor namespaces:

1. Original DOM anchors from `semantic_registry` keys.
2. Virtual anchors created by previous states via `create.id`.

`keep` and `update` may reference either namespace. If referencing a virtual
anchor, it must have been created by an earlier state.

## Trigger Semantics

- `trigger` describes how the user or system enters the current state from the
  previous state.
- A state's `trigger.anchor` must be an original DOM anchor or a virtual anchor
  created by an earlier state.
- Do not set `trigger.anchor` to a component first created inside the current
  state.
- If interaction is available after the current state is rendered, such as back
  button, confirm button, toast timeout, or card click, represent it as `bind`
  patches in `patches`, not as the current state's inbound trigger.
- For `state_1`, `trigger` should be `null` unless the blueprint explicitly
  models a return transition as a separate state.

## Core Rules

1. Use registry anchor names exactly for original DOM anchors.
2. New `create.id` values become virtual anchors that later states may reference.
3. Prefer `keep` for original/virtual anchors that should remain visible.
4. Prefer `create` for new UI components.
5. Prefer `update` for changing content/state of a previously created component
   or a simple text/content change to an original anchor.
6. `label` is an internal state name and must not become visible UI text.
7. UI text must come from description, implementation_plan, brief, or explicit
   visible text in the registry.
8. If a state keeps top/status anchors, created full-page content must start
   below those anchor bboxes.
9. If a state keeps bottom/nav anchors, created content must end above those
   anchor bboxes.
   If this leaves insufficient vertical space for non-floating content, allow
   the state page to extend downward beyond `initial_height` while keeping the
   same width.
10. If the state is not modal/drawer/popover/toast/overlay, every create/update
    bbox must avoid overlap with all kept bboxes for that state.
11. Generated component descriptions should support an antd Mobile style output:
    clean cards, primary buttons, rounded inputs, light dividers, and restrained
    elevation.
12. Preserve Gestalt design principles: related elements should be close,
    aligned, visually similar, and grouped with clear hierarchy.
13. Do not split repeated list-row actions into separate top-level components.
    If a `List`/`Grid`/`CardList` item contains a visible action such as
    "查看", "详情", "编辑", or "删除", describe that action inside the parent
    list component's visible text/props instead of adding a separate Button
    create patch mounted inside the list.

## Patch Types

- `bind`: connect an original or virtual anchor to `goto:state_N`
- `keep`: do not use as a patch; put anchors in `inheritance.keep`
- `create`: describe new UI to create; put patches in `inheritance.create`
- `update`: update content/state of an anchor; put patches in
  `inheritance.update`

## Validation Checklist

- Every non-`state_1` state has `parent_state`.
- Every trigger anchor exists in original anchors or previous virtual anchors,
  unless it is a system trigger such as `timeout`, `data_loaded`, or
  `submit_success`.
- Every keep/update target exists in original anchors or previous virtual
  anchors.
- Every non-modal create/update bbox avoids all kept bboxes for the state.
- No `hide`, `replace`, `inheritance.hide`, or `inheritance.replace` is present.
- No create visible text equals internal labels such as `state_2` or an internal
  Chinese state label ending with `态`.
