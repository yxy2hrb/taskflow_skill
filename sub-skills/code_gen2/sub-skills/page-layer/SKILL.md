---
name: taskflow-page-layer-codegen
description: Generate placeholder-based mobile state layers from React component metadata, keep anchors, layout hints, and global CSS.
---

# Taskflow Page Layer Codegen

Generate placeholder-based state layers for a taskflow prototype.

This stage uses the LLM for page layout only. It must output keep placeholders
and component placeholders plus state-level layout CSS. It must not inline final
component HTML/CSS. The runner replaces placeholders with React SSR HTML/CSS
after the LLM output is parsed.

## Goal

Build state layer JSON from:

- `state_implementation_model`
- `component_codegen` metadata, including React source snippets and component
  layout/content metadata
- `semantic_registry`
- `blueprint`
- `viewport`
- `global_css`

The page layer owns only state-level composition:

1. one `<section>` per non-initial state
2. keep placeholders for original DOM anchors
3. top-level generated component placeholders
4. placeholder layout CSS
5. final runner replacement of component placeholders with rendered React SSR
   HTML/CSS

It must not regenerate component bodies. It must not flatten or render nested
children. Nested children are already imported and rendered inside their
top-level parent component by recursive component-codegen.

## Output JSON

```json
{
  "html": "<section id=\"tf-state-2\" class=\"tf-state-layer tf-llm-layer\" style=\"display:none\">...</section>",
  "css": ".tf-llm-layer .tf-flow-group{...}",
  "reactCode": "",
  "validation_notes": "placeholder page layout"
}
```

Required fields:

- `html`: one `<section>` per non-initial state.
- `css`: all CSS required by those sections.

Optional fields:

- `reactCode`: keep as an empty string. It is not executed by the runner.
- `validation_notes`: short assumptions or warnings.

## Layer Contract

1. Generate one layer per non-initial state.
   Do not omit any non-initial state.
2. Each layer must use:
   `<section id="tf-state-N" class="tf-state-layer tf-llm-layer" style="display:none">...</section>`
3. Do not generate a layer for `state_1`; the original D2C page remains visible for state 1.
4. Use only classes under `tf-llm-*` or `tf-state-*` namespaces.
5. Do not include `<script>`, external links, CDN imports, framework bootstrapping, or event handlers.
6. The result is static. Do not implement interactions.
7. `viewport.width` is fixed and must not be changed.
8. `viewport.initial_height` is the original capture viewport height, not a hard maximum.
9. If `state_implementation_model.states[].height` is greater than
   `viewport.initial_height`, that state layer may be taller and scroll
   vertically. The runner will use the per-state `height` for layer min-height
   and screenshots.
10. Never increase page width.
11. Do not put `position`, `left`, `top`, `width`, `height`, or `z-index` on
    the `<section>` root. The runner owns layer positioning. Put positioning on
    children inside the layer only.

## Placeholder Layout Rules

For each non-initial state, emit section children in this order:

1. keep placeholders for `state.inheritance.keep` entries that are original DOM
   anchors
2. top-level kept virtual components inherited from previous states, such as
   the base page, cards, nav bars, or bottom bars
3. current-state top-level update components
4. current-state top-level create components, especially overlays, masks,
   sheets, drawers, dialogs, and toasts

Top-level generated components come from:

- direct items in `state.inheritance.create`
- direct items in `state.inheritance.update`
- kept virtual component ids from earlier states, but only when the matching
  `component_codegen` record is top-level

Inherited virtual components must render below current-state overlays and
sheets. Do not let a kept bottom bar or nav bar appear above a newly created
modal/sheet unless the state explicitly updates that bar with a higher z-index.

Do not walk into `children` arrays while collecting page-layer components.
Children are implementation details of the parent component tree.

For ordinary auto-height page cards:

- Prefer flow layout over fixed absolute `top`.
- Use groups, order, and spacing from `state_implementation_model.layout`.
- If a card has no fixed bbox, create a wrapper such as
  `<div class="tf-llm-flow-item" data-flow-id="component_id">` and put the
  component placeholder inside it.
- Keep components in visual order and avoid overlap by using normal document
  flow, grid, or flex layout.
- Use `global_css` tokens for spacing, colors, radius, and typography when
  writing wrapper CSS.

For fixed components:

- Use fixed bbox hints from state model, such as overlays, modals, bottom
  sheets, top nav, bottom bars, toasts, and floating action bars.
- If a component in `state_implementation_model` has a `bbox`, that bbox is
  authoritative. The placeholder must be wrapped in a `tf-component-frame`
  whose inline style includes `position:absolute`, `left`, `top`, `width`, and
  `height` from that bbox. Only components without a bbox may use free/flow
  layout.
- If a fixed component has `props.zIndex`, put that z-index on the wrapper
  around its placeholder.
- BottomSheet and Modal placement must follow the state model fixed bbox.
- Fixed main/body regions at the same z-index must be bbox-mutually exclusive.
  Status bar, top nav, body content, and bottom bar must not overlap unless one
  is an intentional higher-z overlay/modal/sheet/toast or a transparent hero
  background.
- Keep anchors such as status bar must not overlap generated body wrappers at
  the same z-index. Place body flow groups below kept top/status anchors and
  above kept bottom/nav anchors.
- Every modal/sheet/dialog/drawer layer must include a global overlay/mask
  placeholder when the state model provides one.
- A layer's overlay z-index must be lower than its own sheet/dialog z-index and
  higher than all content it should dim.
- For second-level modals, the second-level overlay z-index must be higher than
  the first-level sheet/dialog z-index, so it covers the first-level modal. The
  second-level sheet/dialog must be higher than the second-level overlay.

## Keep Placeholder Contract

For every kept original area that should visually remain:

```html
<div class="tf-keep-placeholder" data-keep-anchor="语义锚点名"></div>
```

Rules:

1. `data-keep-anchor` must exactly match a key from `semantic_registry`.
2. Do not duplicate original status bar, nav bar, workbench card, tab bar, or kept D2C content manually.
3. The runner will fill each placeholder by cropping original D2C content from `semantic_registry` bbox.
4. If a state is a full-screen replacement page, keep only required persistent areas.
5. Never hide keep placeholders. Do not output CSS such as
   `.tf-keep-placeholder{display:none}`,
   `.tf-llm-layer .tf-keep-placeholder{display:none}`, `visibility:hidden`,
   `opacity:0`, or equivalent rules that make kept original areas invisible.
6. If a state keeps the status bar or top system bar, generated background or
   container components must not cover that kept bbox unless they are
   transparent and have a lower z-index than the keep placeholder.
7. Keep placeholders must render above generated components. The runner gives
   them a protected high z-index so original kept areas such as the status bar
   are not hidden by full-width hero images, nav bars, masks, or component
   backgrounds.

## Component Placeholder Contract

For every top-level generated component that should appear in a state, first
emit this placeholder:

```html
<div class="tf-component-placeholder" data-component-id="component_id"></div>
```

Rules:

1. `data-component-id` must exactly match a top-level component id from
   `component_codegen`.
2. The runner replaces placeholders with the latest matching rendered
   `component.html` for the current state or a previous state.
3. The runner appends the matching `component.css`.
4. Do not output `component.html`, `component.css`, `reactCode`, SVG-heavy
   bodies, or duplicated inline styles manually.
5. Do not create placeholders for nested children. For example, if a top-level
   `tools_card` imports and renders child `tools_grid`, the page layer inserts
   only `tools_card`.
6. You may wrap placeholders in state-level layout elements such as
   `tf-llm-flow-group`, `tf-llm-flow-item`, or `tf-component-frame`.
   When the component has a bbox, `tf-component-frame` is required and must
   carry the exact bbox values as inline `left/top/width/height` styles.
7. Do not add or rewrite component internals. Component background, internal
   layout, and child composition belong to the generated React component.
8. If a fixed bbox is available, preserve it in `tf-component-frame` during
   placeholder layout. The runner also enforces this as a safety net during
   replacement.
9. If no bbox is available, the runner must preserve your flow wrapper and only
   replace the placeholder node itself.

## Recursive Component Boundary

The state model may contain a tree like:

```json
{
  "id": "tools_card",
  "component": "SectionLayout",
  "bbox": [12, 816, 336, 120],
  "children": [
    {
      "id": "tools_grid",
      "component": "IconGrid",
      "props": { "cols": 4, "items": [] }
    }
  ]
}
```

The component-codegen stage generates `tools_grid` first, then generates
`tools_card` with `import Child_tools_grid from "./tools_grid"`. The rendered
`tools_card` HTML already includes `tools_grid`.

Therefore the page layer must output only:

```html
<div class="tf-component-placeholder" data-component-id="tools_card"></div>
```

It must not also output a placeholder for `tools_grid`.

## Ant Design Visual Language

This stage does not create Ant Design component markup. Visual language is
enforced by state-implementation-model and component-codegen. The page layer may
create neutral wrappers and CSS for spacing, flow, columns, scroll containers,
masks, and stacking only.

## Floating Components

Floating behavior is also owned by top-level components:

1. Overlay masks, drawers, bottom sheets, dialogs, and toasts are top-level
   generated components when they must layer over the base page.
2. Their `bbox`, `zIndex`, and bottom alignment are resolved before this stage.
3. The page layer must place current-state overlays/sheets above inherited base
   components and bottom bars.

## JSON Discipline

1. Return valid JSON parsable by `JSON.parse`.
2. Escape quotes inside HTML/CSS strings correctly.
3. Do not wrap the JSON in markdown fences.
4. `css` should contain only state-level wrapper/layout styles. `reactCode`
   should stay empty.
5. Do not invent component ids, keep anchors, text, or layout.
6. Do not inline component SSR HTML. Use only:
   `<div class="tf-component-placeholder" data-component-id="component_id"></div>`.
