---
name: taskflow-component-codegen
description: Generate React component source for taskflow create/update components, then render it to static HTML/CSS in the runner.
disable-model-invocation: true
---

# Taskflow Component Codegen

Generate one React component source file at a time. For patch trees, the runner
generates children first, then asks for the parent with import metadata for
those generated children. The runner will render the React source to static HTML
before page-layer injection.

Component-codegen is a renderer, not a data authoring stage. All business copy,
rich card fields, item lists, prices, tags, actions, and labels must already be
present in `component`, `component.props`, `component.children`,
`generated_children`, or text/style fields from `state_implementation_model`.
Do not invent additional business data to make a card look richer.

Return strict JSON only:

```json
{
  "id": "component_id",
  "reactCode": "import React from 'react';\nexport default function GeneratedComponent(){ return <div data-component-id=\"component_id\">...</div>; }",
  "css": ".tf-cg-card{...}",
  "notes": "optional short note"
}
```

## Inputs

Create input:

- `operation: "create"`
- `component`: the create patch from `state_implementation_model`
- `generated_children`: optional direct children that have already been
  generated, each with `id`, `component`, `importName`, `importPath`, and
  original child props/text metadata
- `viewport`
- `state_context`

Update input:

- `operation: "update"`
- `component`: the update patch from `state_implementation_model`
- `component.modifications`: the expanded change plan. Each entry pinpoints one
  changed internal part — `target` (child id, prop path such as
  `props.primaryLabel`, slot path such as `footer.primary`, or literal `text` /
  `text_style` / `bbox` / `layout`), optional `target_component` (the child's
  component name), `parent` (the id owning the changed part), and `change`
  (the concrete modification plan, usually with before → after values)
- `component.preserve`: internal parts (child ids, prop paths, `text`, `bbox`,
  `layout`) that must stay exactly as in the previous implementation
- `component.modifications_applied`: the cumulative ledger — every modification
  since the component's ORIGINAL implementation, with later entries on the same
  target winning. Use it when rebuilding from `original_reference` so changes
  from earlier states are not lost.
- `original_component`: previous generated React source for the same component id
- `original_reference`: present instead of `original_component` when the update
  targets an original captured-page card with no previous React source. Carries
  the original card's registry data (`anchor`, `component`, `text`, `bbox`) —
  ground truth for the card's real content; do not invent content beyond it and
  the patch.
- `viewport`
- `state_context`

## Rules

1. Output `reactCode`; do not output hand-written `html`.
2. `reactCode` must be a self-contained TSX/JSX module with `import React from "react"` and `export default function ...`.
3. The default exported component must render exactly one root element.
4. The root element must include `data-component-id="<component.id>"`.
5. Use the provided reference components as real React component source patterns. You may import from `@/components/<Name>` and compose them, or inline equivalent JSX when composition is simpler.
6. Do not use browser-only side effects, data fetching, timers, portals, external links, CDN, or runtime script tags.
7. Event handlers may be inert no-op functions only when a referenced component requires them.
8. Use Ant Design Mobile / Harmony design language: clean white cards, rounded inputs, primary buttons, light dividers, subtle shadows, neutral backgrounds.
9. Use `bbox` as absolute page layout only when available on the current
   component. Child components often omit page-level `bbox`; render those as
   relative/content-sized pieces using `props.width`, `props.height`, text, and
   documented component props.
10. Preserve `component.id` as an internal attribute only. Never show ids, debug names, or state labels as visible UI text.
11. For create, render the component from the patch.
12. For update, start from `original_component.reactCode` and apply only the
    changes listed in `component.modifications`: locate each entry's `target`
    inside the previous implementation and apply its `change`. Every part named
    in `component.preserve` — and any part not named by a modification — must
    keep the previous implementation's structure, classes, and content
    unchanged. Do not regenerate the whole component from scratch when
    `modifications` is present. When there is no `original_component` and
    `original_reference` is provided instead, rebuild the card from the
    reference's real content plus the patch, applying
    `component.modifications_applied` (the cumulative ledger) so earlier
    states' changes are included.
13. CSS must use `tf-cg-*` classes, CSS variables, or target `[data-component-id="..."]`. Avoid broad global selectors.
14. Use visible text only from `component.visible_text`, `component.text`,
    `component.props`, `component.children`, `generated_children`, or explicit
    labels/actions in the current patch. Do not use `state_context.ui_intent` to
    invent new business fields.
15. If the input component has `props.zIndex` or `zIndex`, render it as inline
    `zIndex` on the root element.
16. If the input component has `text_style` or `props.textStyles`, apply those
    font tokens to the corresponding visible text. Prefer provided
    `className`, `fontSize`, `lineHeight`, `fontWeight`, and `color` over
    guessing new typography.
17. If `generated_children` is present, import every child using its provided
    `importName` and `importPath`, then render those imported child components.
    Do not rewrite or duplicate the child component implementation inside the
    parent.
18. If `component.content_density` is `rich`, assume the state model has already
    supplied the rich content. Render all provided fields faithfully. If a
    required-looking field is absent, do not fabricate it; keep the layout
    graceful and mention the missing field in `notes`.
19. Do not add prices, stock, service tags, comments, ratings, dates, provider
    names, or action labels unless they are present in the input component tree.

## Layout Context Contract

Nested components may receive `layout_context` from the runner. This is the
contract between parent containers and child components:

1. If `layout_context` is present, the component is rendered inside a parent
   container. Its root must stay within that parent content box: use
   `width: "100%"`, `maxWidth: "100%"`, `minWidth: 0`, and
   `boxSizing: "border-box"` unless the child has its own explicit `bbox` or
   explicit width.
2. Never use hard viewport defaults such as `width: 360`, `minWidth: 328`, or
   fixed page-level coordinates for a nested child. Those are allowed only for
   `is_top_level=true` components or components with their own explicit bbox.
3. Treat `layout_context.available_width` / `available_height` as the maximum
   usable size for child layout. Child defaults may fill that space, but must
   not exceed it.
4. `layout_context.slot` describes the semantic placement (`header`, `body`,
   `footer`, or `content`). Footer/action children inside `Dialog` or `Modal`
   should render compact rows that fit the parent width.
5. For `ButtonBar` inside a `Dialog`/`Modal` footer, pass `width="100%"` when
   importing the reference component. If the reference component cannot fit the
   available width, inline an equivalent compact two-button row using `flex: 1`,
   `minWidth: 0`, and parent-bounded padding.

## Container Components

Container-like components include names such as `Container`, `Layout`, `Panel`,
`Section`, `Wrapper`, `Root`, `Shell`, `Dialog`, `Modal`, `BottomSheet`,
`Drawer`, or `Popup`.

For these components:

1. Render the visual container shell: background, size, absolute bbox, border,
   radius, padding, shadow, scroll behavior, and spacing context.
2. If `generated_children` is present and the current component is a documented
   container such as `SectionLayout`, call the documented container and pass the
   imported children through its React `children` slot or documented layout
   slots. For example, import `ChildA` and render
   `<SectionLayout ...><ChildA /></SectionLayout>`.
3. If `generated_children` is present and the current component is a custom
   container, render only the shell/background/layout and place imported
   children inside that layout. Do not render child business copy yourself.
4. If the current patch explicitly provides `visible_text`, `text`, `props`,
   or `description` for container-owned content, render that content inside the
   container. This includes titles, close buttons, clear actions, headers,
   footers, and simple body copy for BottomSheet/Drawer/Modal/Dialog.
5. If the patch describes a complete modal or sheet and no separate mounted
   child patches exist, it is allowed to render the title/header/action area and
   the key visible content described by the patch.
6. If the patch is a complete `BottomSheet`, `Drawer`, `Modal`, or `Dialog`
   with structured `props.body` / `props.footer`, render that complete content
   inside the component. Do not require separate child patches.
7. If this component input has `mount: "<container_id>"`, treat mount as
   semantic ownership. If the parent received this component in
   `generated_children`, the parent is responsible for DOM composition.
8. Do not invent an entire unrelated page from `state_context.ui_intent`; only
   render content that belongs to the current patch.
9. For content-driven cards with `layout.heightMode: "auto"`, do not force a
   fixed page-positioned height. Render the natural content height. Page-layer
   will place the component.
10. Fill-width children must NOT be placed side-by-side in a horizontal flex row.
    Any imported child whose `layout_context.child_should_fill_parent` is true
    renders with `width: 100%` and fills the parent content width. If two such
    children share one `display:flex` / `flex-direction:row` line, their
    `width:100%` bases overflow the row and a `flex:1` sibling collapses to ~0
    width, so its text wraps one character per line (broken vertical text). Stack
    fill-width children VERTICALLY (one per line / `flex-direction:column`). Only
    if the design needs a label and a compact badge/status on the SAME line, do
    not use two raw fill-width children there: render the compact inline content
    yourself, or wrap each child in an explicit flex item that overrides the
    width — the flexible one `flex: 1 1 0; min-width: 0`, the compact one
    `flex: 0 0 auto` with `width: auto`.

## Floating Surface Output Contract

For floating-surface components — `BottomSheet`, `Drawer`, `Modal`, `Dialog`,
`Popover` — render only the surface (panel) itself. Positioning and the dim
backdrop are owned by other stages, not by this component:

1. Do NOT render a full-screen backdrop/mask inside the component. The dim layer
   is a separate `Overlay`/mask component created by the state model and placed
   by page-layer. A self-rendered mask produces a double overlay.
2. Do NOT self-position with page coordinates. Never emit a full-viewport root
   (e.g. `top:0;height:936`) or an absolute page-coordinate panel
   (e.g. `top:336px`). Render the panel so it fills its parent container
   (`width:100%`, intrinsic or `height:100%`); page-layer's component frame
   provides the actual on-screen placement via the state model `bbox`.
3. Use the page-layer surface class convention so layout fixups apply: the panel
   root should be `tf-cg-sheet` (not a private alias such as `tf-cg-bottom-sheet`),
   the scrollable body `tf-cg-sheet-body`, and the action row `tf-cg-sheet-footer`.
4. Keep the footer/primary action (`确定`/`确认`/`应用`) inside the panel and
   within its natural height so it is not pushed below the viewport.

## Recursive Composition Contract

- The runner generates a tree bottom-up. Leaf components receive no
  `generated_children`. Parent components receive only already-generated direct
  children.
- Parent React code must import generated direct children with the exact
  `importName` / `importPath` values. Do not paste the child source code into
  the parent.
- Parent CSS may define layout wrappers around imported children, but should not
  target a child's private classes except for coarse spacing through wrapper
  elements.
- The final page layer will insert only top-level component HTML. Therefore a
  top-level parent component must include its imported child components in its
  rendered output.

## Typography Contract

When the input includes text style metadata:

- `text_style.className` should be copied to the text element className when
  possible.
- `text_style.fontSize`, `lineHeight`, `fontWeight`, and `color` should be
  applied as inline style when present.
- `props.textStyles` may contain named slots such as `title`, `body`,
  `primaryButton`, `secondaryLabel`, `tag`, or `price`; apply the matching slot
  to each visible text.
- If no style metadata is provided, use the closest global.css font class:
  `font-headline-xxl` for page titles, `font-headline-s` for section titles and
  primary buttons, `font-body-m` for body copy, `font-caption-m` for secondary
  copy, and `font-caption-s` for tags.

## Runner Contract

The runner will:

1. Bundle `reactCode` with local aliases such as `@/components/*`.
2. Render it through `react-dom/server` to produce `component.html`.
3. Store both the source `reactCode` and the rendered `html/css`.

For update calls, only React source is passed back as `original_component`; do not
base the update on previously rendered HTML.
