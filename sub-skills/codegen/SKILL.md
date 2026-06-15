---
name: taskflow-codegen
description: Generate taskflow state implementation models and LLM-authored static page layers from blueprint and semantic registry.
disable-model-invocation: true
---

# Taskflow Codegen

This sub-skill turns a confirmed blueprint and semantic registry into renderable state layers.

## Sub-skills

1. `sub-skills/state-implementation-model`
   - Uses `SKILL.md` as the model prompt.
   - Generates `state_implementation_model.llm.json`.
   - Validates that only `keep`, `create`, and `update` are used.

2. `sub-skills/page-layer`
   - Uses `SKILL.md` as the page-generation prompt.
   - Injects blueprint, semantic registry, and state implementation model.
   - Generates static HTML/CSS state layers.
   - Performs keep-placeholder fill and Playwright screenshot validation.

## Output

- `state_implementation/state_implementation_model.llm.json`
- `llm_layer_codegen/llm_layer.generated.json`
- `html/Index.state-model.llm-layers.html`
- `llm_layer_codegen/auto_shots/state_layers_report.json`
