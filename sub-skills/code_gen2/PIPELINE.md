# code_gen2 Pipeline

This document describes the self-contained `code_gen2` generation path inside
`taskflow-llm-pagegen`.

## Scope

`code_gen2` owns the React-first generation stages:

```text
blueprint + semantic_registry
  -> state_implementation_model
  -> recursive component-codegen
  -> placeholder page-layer
  -> React SSR replacement
  -> Playwright screenshots
```

All prompts, local component references, CSS tokens, SSR shims, runner scripts,
and validation logic for these stages live under:

```text
.cursor/skills/taskflow-llm-pagegen/sub-skills/code_gen2/
```

The only required external inputs are case files and prior pipeline outputs:
preprocessed HTML, semantic registry, blueprint, and viewport values.

## Stage 1: State Implementation Model

Path:

```text
sub-skills/code_gen2/sub-skills/state-implementation-model
```

Goal:

- Convert blueprint states and semantic registry into
  `state_implementation_model.llm.json`.
- Model every state with `inheritance.keep`, `inheritance.create`, and
  `inheritance.update`.
- Decide rich card business content in this stage.
- Use content-driven layout hints for ordinary cards.
- Use fixed bbox for fixed-position components such as overlays, sheets,
  modals, top bars, and bottom bars.

Key constraints:

- Ordinary cards do not need fixed `bbox` by default.
- Ordinary cards should use `layout.group`, `layout.order`,
  `layout.heightMode: "auto"`, and related hints.
- `content_density: "rich"` cards must include enough concrete business fields.
- Fixed components at the same z-index must have mutually exclusive bboxes.
- Every modal/sheet layer must have a global overlay.
- Stacked modals must increase z-index in this order:
  base content, first overlay, first sheet, second overlay, second sheet.

Outputs:

```text
state_implementation/state_implementation_model.llm.json
state_implementation/state_implementation_model.llm.validation.json
```

## Stage 2: Recursive Component Codegen

Path:

```text
sub-skills/code_gen2/sub-skills/component-codegen
```

Goal:

- Generate React source for each state model component.
- Generate child components before parent components.
- Let parent components import generated children instead of rewriting them.
- Render React source to static HTML/CSS through local SSR.

Key constraints:

- Component-codegen is a renderer, not a data authoring stage.
- It must not invent prices, stock, providers, comments, or other business data.
- Child components normally do not receive page-level bbox.
- Parent components are responsible for container structure and composition.
- The final page layer inserts only top-level parent components.

Inputs:

- `state_implementation_model.llm.json`
- local `resources/components`
- local `resources/global.css`
- local component reference README

Outputs:

```text
code_gen2_component_codegen/component_codegen.generated.json
code_gen2_component_codegen/react_sources/*.tsx
code_gen2_component_codegen/raw/*.raw.txt
```

## Stage 3: React SSR

Path:

```text
sub-skills/code_gen2/scripts/react_ssr.js
```

Goal:

- Bundle generated React source.
- Resolve local aliases and component imports.
- Server-render generated React to static HTML.
- Attach design-system CSS.

Local resources:

- `resources/components`
- `resources/global.css`
- generated shims under `.react_ssr/shims`

Generated caches:

```text
.react_ssr/
.render_check/
.tmp_verify/
```

These directories are runtime caches and are ignored by `.gitignore`.

## Stage 4: Placeholder Page Layer

Path:

```text
sub-skills/code_gen2/sub-skills/page-layer
```

Goal:

- Generate one state layer per non-initial state.
- Use `tf-keep-placeholder` for original DOM anchors.
- Use `tf-component-placeholder` for generated React components.
- Let the LLM solve page-level placeholder layout using state model hints,
  component metadata, keep anchors, and `global.css`.
- Keep final component HTML out of the LLM output.

Important rule:

The LLM writes placeholder layout, not final component DOM.

Example:

```html
<section id="tf-state-3" class="tf-state-layer tf-llm-layer">
  <div class="tf-keep-placeholder" data-keep-anchor="顶部状态栏-顶部横向区域"></div>
  <div class="tf-component-frame" style="z-index:50">
    <div class="tf-component-placeholder" data-component-id="sheet_overlay_1"></div>
  </div>
  <div class="tf-component-frame" style="z-index:60">
    <div class="tf-component-placeholder" data-component-id="product_list_sheet"></div>
  </div>
</section>
```

Runner safeguards:

- Inserts missing status-bar keep placeholders.
- Avoids double-wrapping components when LLM already emits a frame.
- Replaces component placeholders with React SSR HTML/CSS.
- Neutralizes internal sheet masks so global overlays own mask darkness.
- Normalizes keep visibility.

Outputs:

```text
code_gen2_llm_layer_codegen/llm_layer.generated.json
html/Index.state-model.code-gen2-layers.html
code_gen2_llm_layer_codegen/auto_shots/state_layers_report.json
```

## Stage 5: Playwright Validation

Goal:

- Open the generated static HTML.
- Switch through all states.
- Capture screenshots.
- Report missing layers, invisible layers, and blank screenshots.

Validation output:

```text
code_gen2_llm_layer_codegen/auto_shots/state_layers_report.json
```

## Running code_gen2 End To End

```bash
node .cursor/skills/taskflow-llm-pagegen/scripts/run_skill.js new_test/13 \
  --model qwen3.7-max \
  --codegen code_gen2 \
  --width 360 \
  --height 936
```

## Running Individual code_gen2 Stages

State model:

```bash
node .cursor/skills/taskflow-llm-pagegen/sub-skills/code_gen2/sub-skills/state-implementation-model/scripts/run_skill.js new_test/13 \
  --model qwen3.7-max \
  --blueprint new_test/13/.run_skill/<stamp>/blueprint/phase4/stages/blueprint_builder_input.json \
  --registry new_test/13/.run_skill/<stamp>/preprocess/semantic_registry.json \
  --out new_test/13/.run_skill/<stamp>/state_implementation/state_implementation_model.llm.json \
  --width 360 \
  --height 936
```

Component codegen:

```bash
node .cursor/skills/taskflow-llm-pagegen/sub-skills/code_gen2/sub-skills/component-codegen/scripts/run_skill.js new_test/13 \
  --model qwen3.7-max \
  --state-model new_test/13/.run_skill/<stamp>/state_implementation/state_implementation_model.llm.json \
  --out-dir new_test/13/.run_skill/<stamp>/code_gen2_component_codegen \
  --width 360 \
  --height 936
```

Page layer:

```bash
node .cursor/skills/taskflow-llm-pagegen/sub-skills/code_gen2/sub-skills/page-layer/scripts/run_skill.js new_test/13 \
  --model qwen3.7-max \
  --html new_test/13/.run_skill/<stamp>/preprocess/Index.preprocessed.html \
  --registry new_test/13/.run_skill/<stamp>/preprocess/semantic_registry.json \
  --state-model new_test/13/.run_skill/<stamp>/state_implementation/state_implementation_model.llm.json \
  --blueprint new_test/13/.run_skill/<stamp>/blueprint/phase4/stages/blueprint_builder_input.json \
  --component-codegen new_test/13/.run_skill/<stamp>/code_gen2_component_codegen/component_codegen.generated.json \
  --out-dir new_test/13/.run_skill/<stamp>/code_gen2_llm_layer_codegen \
  --out-html new_test/13/html/Index.state-model.code-gen2-layers.html \
  --width 360 \
  --height 936
```
