---
name: taskflow-code-gen2
description: Experimental hw-components codegen copy with component resources, generating taskflow state implementation models and static page layers.
disable-model-invocation: true
---

# Taskflow Code Gen2

This sub-skill is the self-contained React-first code generation path for the
taskflow pagegen pipeline. All code_gen2 prompts, runner scripts, component
references, CSS tokens, SSR aliases, and validation logic live under this
`sub-skills/code_gen2` directory.

External inputs are limited to the case files and prior pipeline outputs:
blueprint, semantic registry, preprocessed HTML, and optional viewport values.
Runtime dependencies such as Node packages and API keys are resolved from the
current workspace environment, but no old taskflow codegen scripts or external
application source trees are required.

This sub-skill turns a confirmed blueprint and semantic registry into renderable
state layers. Its component path is React-first: component generation produces
React source, the runner server-renders that source to static HTML, and page
layers inject the rendered HTML/CSS.

## Sub-skills

1. `sub-skills/state-implementation-model`
   - Uses `SKILL.md` as the model prompt.
   - Generates `state_implementation_model.llm.json`.
   - Validates that only `keep`, `create`, and `update` are used.

2. `sub-skills/page-layer`
   - Uses `SKILL.md` as the page-generation prompt.
   - Injects blueprint, semantic registry, state implementation model, local
     component metadata, and local `resources/global.css`.
   - Generates placeholder-based static state layers.
   - Replaces placeholders with React SSR output.
   - Performs keep-placeholder fill and Playwright screenshot validation.

3. `sub-skills/component-codegen`
   - Uses the local `resources/components` React source as real component
     building blocks.
   - Stores both `reactCode` and React-SSR rendered `html/css`.
   - For update operations, passes previous React source back to the model, not
     the rendered HTML.

## Local Resources

- `resources/components`: component reference source and README used by
  state-model and component-codegen prompts.
- `resources/global.css`: design tokens used by component-codegen and
  page-layer.
- `scripts/react_ssr.js`: local React SSR bundling, aliases, and shims.
- `scripts/validate_component_render.js`: local component reference smoke test.
- `.react_ssr`, `.render_check`, and `.tmp_verify`: generated runtime caches;
  ignored by `.gitignore` and not required as source inputs.

## Output

- `state_implementation/state_implementation_model.llm.json`
- `code_gen2_component_codegen/component_codegen.generated.json`
- `code_gen2_llm_layer_codegen/llm_layer.generated.json`
- `html/Index.state-model.llm-layers.html`
- `code_gen2_llm_layer_codegen/auto_shots/state_layers_report.json`
