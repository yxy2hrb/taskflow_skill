---
name: taskflow-preprocess
description: Preprocess taskflow HTML by generating/reusing page DSL, collecting div bboxes, generating semantic annotations, replacing body markup, and building the semantic registry.
disable-model-invocation: true
---

# Taskflow Preprocess

This sub-skill prepares the original D2C HTML and page DSL for blueprint and code generation.

## Responsibilities

1. `scripts/run_preprocess.js`
   - Reuses `<inputDir>/spec.json` when present.
   - If `spec.json` is missing, calls Qwen VL on the source screenshot and writes `<inputDir>/spec.json`.
   - Writes `spec.used.json` and, when generated, `spec.generated.json` in the preprocess output.

2. `scripts/build_div_bbox.js`
   - Uses Playwright to inspect the mobile page.
   - Outputs candidate div bbox information.
   - Keeps bbox data compact for LLM semantic annotation.

3. `scripts/run_preprocess.js`
   - Builds the semantic annotation prompt inline.
   - Calls Qwen to annotate meaningful divs.
   - Runs `scripts/replace_body.py`.
   - Outputs `Index.preprocessed.html`, `annotated_body_semantic.html`, and `report.json`.

4. `scripts/build_semantic_registry.js`
   - Converts annotated HTML into `semantic_registry.json`.
   - Outputs `semantic_anchors.js`.

## Output

- `preprocess/Index.preprocessed.html`
- `preprocess/spec.used.json`
- `preprocess/spec.generated.json` when `spec.json` was generated
- `preprocess/annotated_body_semantic.html`
- `preprocess/div_semantic.json`
- `preprocess/semantic_registry.json`
- `preprocess/semantic_anchors.js`
