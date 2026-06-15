---
name: taskflow-state-implementation-model-llm
description: Generate taskflow state implementation model from blueprint and semantic registry.
---

# State Implementation Model LLM

## Goal

Use the LLM, not scripted heuristics, to convert confirmed blueprint states,
tree-shaped semantic registry data, anchor bbox/text information, and page
context into a machine-readable state implementation model.

The output is only the state model. Do not repeat semantic anchors,
semantic_registry, or full HTML in the output. The runner joins registry data
before the next stage.

## Inputs

- `blueprint_builder_input.json`
- `semantic_registry`, a tree-shaped registry. Each node includes `anchor`,
  `selector`, semantic/component metadata, visible `text`, inheritance `policy`,
  `bbox`, and `children`. Text anchors are included as child/leaf nodes.
- `component_library_reference`, a Markdown reference for the available
  code_gen2 component library, including component names, props, and usage
  scenarios
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
      "height": 792,
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
- Every update patch must include a non-empty `modifications` array and a
  `preserve` array describing which internal parts change and which stay
  exactly as the previous implementation. See "Update Patch Modification List".
- `height` must be a number for every state.
- Do not output `inheritance.hide`.
- Do not output `inheritance.replace`.
- Do not output hide or replace patches.
- `patches` is only for explicit interaction bindings when needed, especially
  `bind` patches.
- A top-level create patch must include `type: "create"`, `id`, `component`,
  visible content fields when applicable, and either fixed `bbox` or weak
  `layout` hints. Ordinary page cards should use weak layout hints; fixed
  overlay-like components must use `bbox`.
- Ordinary page cards should not output `bbox` by default. Do not invent
  exact `x`, `y`, or `height` unless the page has a clear start point, anchor,
  sticky/floating behavior, two-column grid, or fixed system area. Use
  `layout.group`, `layout.order`, `layout.flow`, `layout.widthHint`,
  `layout.heightMode: "auto"`, `layout.startAnchor`, and `layout.spacingHint`
  to express relative layout instead.
- Fixed containers must output `bbox`: `BottomSheet`, `Drawer`, `Modal`,
  `Dialog`, `Toast`, `Overlay`, masks, top navigation, bottom bars, floating
  action bars, soft keyboards, and any component that must align to a viewport
  edge.
- Fixed bottom components must be authored against the viewport, not the long
  document canvas. For `viewport.initial_height = H`, a 64px bottom action bar
  must use `bbox: [0, H - 64, width, 64]` and a soft keyboard must use
  `bbox: [0, H - keyboardHeight, width, keyboardHeight]`. Also set
  `props.layoutRole` to `fixed-bottom-action` or `fixed-bottom-keyboard`.
- A `ButtonBar` is NOT automatically a screen-pinned bottom bar. It is only
  treated as a viewport-fixed bottom action bar when you signal that intent:
  either set `props.layoutRole: "fixed-bottom-action"`, or give it an id/name
  that is clearly a bottom bar (e.g. `bottom_action_bar`), or place its `bbox`
  flush against the bottom of the state canvas. Use this only for the real,
  page-level primary action bar pinned to the screen bottom.
- A `ButtonBar` used as an INLINE action row inside the page flow — a
  submit/next row in the middle of a long form, a row of buttons inside a card
  or section — must NOT carry `layoutRole: "fixed-bottom-action"` and must NOT
  be placed flush at the bottom. Author it like ordinary content: give it a
  `bbox` at its real in-page position, or weak `layout` hints
  (`group`/`order`/`startAnchor`/`heightMode:"auto"`). It then flows in place
  instead of being pinned to the screen bottom.
- Do not place more than one screen-pinned bottom bar in the same state; pinned
  bars all collapse onto the same bottom edge and overlap. Pin only the single
  primary bottom action bar; render any other button group inline.
- Container-like create patches may include `children`. Each child must follow
  the same semantic patch shape as a normal create patch: `type`, `id`,
  `component`, `props`, `text` / `visible_text`, `text_style`, and optional
  `children`.
- Child patches inside a parent container should normally omit page-level
  `bbox`. Express only the child component's necessary props and intrinsic
  layout data, such as `text`, `width`, `height`, `price`, `subtitle`, `items`,
  or documented component props. The parent container owns page placement and
  child layout.
- A later state may `keep` or `update` a virtual component id created by an
  earlier state. Do not reference a virtual id before it has been created.
- When updating a virtual component that was previously placed with `layout` or
  fixed `bbox`, preserve that placement. If the placement is unchanged, do NOT
  repeat `layout`/`bbox` in the update patch — omit them and list them in
  `preserve`; the runner deterministically inherits the previous placement.
  Only output `layout`/`bbox` on an update patch when the placement actually
  changes in this state, and record that change in `modifications`. Never let
  an updated input/card/button fall back to the top-left of the page.
- IDs embedded inside structured props, such as `props.footer.primaryId`,
  `props.body[].id`, or an input descriptor inside `BottomSheet.props.body`, do
  not create standalone virtual components. A later state must not `trigger`,
  `keep`, or `update` those ids directly. If an internal control must be
  updated later, either model it as a real child patch under the container or
  update the owning container component itself.
- An `inheritance.update` target id MUST be a TOP-LEVEL component: either an
  original DOM card/container anchor, or a virtual id that some earlier state
  created as a TOP-LEVEL `inheritance.create` patch. NEVER put the id of a
  component that was created as a CHILD inside a container (a Dialog / Modal /
  BottomSheet / Drawer / Card footer, header, body row, button, or input) into
  `inheritance.update`. Promoting a container child to a top-level update
  detaches it from its parent: the runner re-places it as a standalone
  page-level component, so for example a dialog `footer` ButtonBar gets pinned
  to the viewport bottom instead of staying inside the dialog. To change such a
  child, `update` its OWNING top-level container and describe the child change
  inside that container's `modifications` and `children`. The child stays
  inside the container.

## Anchor Namespaces

There are two valid anchor namespaces:

1. Original DOM anchors from `semantic_registry` keys.
2. Virtual anchors created by previous states via `create.id`.

`keep` and `update` may reference either namespace. If referencing a virtual
anchor, it must have been created by an earlier state.

## Trigger Semantics

- `trigger` describes how the user or system enters the current state from the
  previous state.
- `state_1` is the initial state and its `trigger` must be `null` unless the
  blueprint explicitly models an external return entry. Do not put the first
  visible user action, such as tapping a search/filter/card button, on
  `state_1.trigger`; put that outbound interaction in `state_1.patches` as a
  `bind` patch.
- `state_1` MUST NOT create or update components. It is the original captured
  page rendered from app-root, and page-layer does not render its create/update
  patches — so any bind to a state_1-created component is dead and the
  transition will not work. A `state_1.patches[].bind` anchor must be an
  ORIGINAL DOM anchor from `semantic_registry` (e.g. the real "搜索图标-…"
  anchor that already exists on the page), never a newly created virtual id.
  Do not create a new IconButton/etc. on state_1 just to bind it.
- For every non-`state_1` click/tap trigger, make the inbound destination
  explicit with `goto` equal to the current state's own `id`, for example
  `{ "action": "click", "anchor": "搜索图标", "goto": "state_2" }`.
- If `trigger.action` uses `goto:state_N`, `state_N` must equal the current
  state's own `id`. A state's inbound trigger must not point to the next state.
- A state's `trigger.anchor` must be an original DOM anchor or a virtual anchor
  created by an earlier state.
- Do not set `trigger.anchor` to a component first created inside the current
  state.
- If interaction is available after the current state is rendered, such as back
  button, confirm button, toast timeout, or card click, represent it as `bind`
  patches in `patches`, not as the current state's inbound trigger.
- For interactions inside a structured container prop, use the owning component
  id as `trigger.anchor` and put the internal slot in `trigger.target`, such as
  `{ "anchor": "edit_sheet", "target": "footer.primary" }`. Do not set
  `trigger.anchor` to `btn_confirm_edit` unless `btn_confirm_edit` is a real
  child patch created in a previous state.
- `patches[].bind` describes outbound interactions available after the current
  state is rendered. It must use an explicit `goto: "state_N"` target. Do not
  rely on `action: "click"` alone to imply a target.

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
8. If a state keeps top/status anchors, fixed created content must start below
   those anchor bboxes unless it is an intentional transparent/hero background.
   Ordinary flow cards should express this with `layout.startAnchor`.
9. If a state keeps bottom/nav anchors, fixed created content must end above
   those anchor bboxes. Ordinary flow cards should express bottom avoidance with
   `layout.endBeforeAnchor` or by belonging to a scrollable content group.
   If this leaves insufficient vertical space for non-floating content, allow
   the state page to extend downward beyond `initial_height` while keeping the
   same width.
10. If the state is not modal/drawer/popover/toast/overlay, every fixed
    create/update bbox must avoid overlap with all kept bboxes for that state.
    Ordinary auto-height cards should not use bbox and will be laid out by
    page-layer from flow hints.
11. Fixed body regions at the same stacking level must be bbox-mutually
    exclusive. For example, status bar/top nav/body/bottom bar regions must not
    overlap when they share the same z-index. If overlap is intentional, it must
    be modeled as a higher-z overlay, modal, drawer, toast, or transparent hero
    background.
12. Soft keyboard states are special fixed-bottom states. The keyboard must be
    placed at the viewport bottom, and normal bottom action bars should either be
    moved above the keyboard, hidden, or represented by the keyboard return key.
    Do not place the keyboard in the top content flow.
13. Generated component descriptions should support an antd Mobile style output:
    clean cards, primary buttons, rounded inputs, light dividers, and restrained
    elevation.
14. Preserve Gestalt design principles: related elements should be close,
    aligned, visually similar, and grouped with clear hierarchy.

## State Inheritance Reasoning

Before authoring each state after `state_1`, explicitly reason from the previous
state's full visible component set, not only from the previous state's
`inheritance.keep` array.

For every new state:

1. Build the previous visible set mentally from:
   - original DOM anchors kept by the previous state,
   - virtual components created by the previous state,
   - virtual/original components updated by the previous state,
   - components inherited by the previous state from even earlier ancestors.
2. Decide which of those visible items remain visible in the new state and put
   them in `inheritance.keep`.
3. Decide which visible items change content or visual state and put those in
   `inheritance.update`.
4. Decide which items are newly introduced and put those in `inheritance.create`.
5. If the flow returns to or branches from an earlier state, such as jumping back
   to a home/list page, consider all components that were visible in that earlier
   state's accumulated visible set, not just its direct `create` patches.

Modal, drawer, popup, and bottom-sheet states usually preserve the background
state underneath the overlay. Therefore their `inheritance.keep` must include the
background state's visible components that should remain dimmed behind the
overlay, including persistent system/status anchors when they are visible.

If an original status/system bar anchor exists in `semantic_registry` and the new
state is not a full-screen replacement that intentionally redraws the entire top
system area, keep the status/system bar anchor explicitly. Do not rely on
page-layer fallback to restore it.

## Update Patch Modification List

An update patch re-states the component's new full spec, but codegen also needs
an explicit, expanded change plan: which internal parts of the updated parent
component are modified, and which must stay exactly as the previous
implementation. Therefore every update patch must carry:

- `modifications`: a non-empty array. Each entry is one concrete change inside
  the updated component:
  - `target`: the changed part. Use a child patch id, a documented prop path
    such as `props.primaryLabel`, a structured slot path such as
    `footer.primary` or `body[1].quantity`, or the literal `text`,
    `text_style`, `bbox`, or `layout`.
  - `target_component`: the component name of the changed child/slot when the
    target is itself a component; omit for plain prop/text targets.
  - `parent`: the id of the component that directly owns the changed part.
    For top-level prop/text changes this is the update patch's own `id`; for a
    nested child it is that child's direct parent id.
  - `change`: a self-contained modification plan in natural language with
    before → after values when known, for example
    "主按钮文案从「保存」改为「保存中...」，同时 disabled=true 并显示 loading".
  - Machine-applicable values when the change is simple: `set_text` (the new
    text string), `set_text_style` (the new style object), `set_bbox` (the new
    `[x, y, w, h]`), `set_props` (an object of changed prop values). These let
    the runner apply the change deterministically without regenerating the
    component. Always include them when the change is a plain text, style,
    position, or prop value swap.
- `preserve`: an array of internal parts that must remain byte-stable from the
  previous implementation: child ids, prop paths, `text`, `bbox`, or `layout`.
  List at least the visually important untouched parts.

Example:

```json
{
  "type": "update",
  "id": "btn_save",
  "component": "ButtonBar",
  "bbox": [0, 872, 360, 64],
  "props": { "variant": "single-primary", "primaryLabel": "保存中...", "disabled": true, "loading": true },
  "modifications": [
    { "target": "props.primaryLabel", "parent": "btn_save", "change": "主按钮文案从「保存」改为「保存中...」" },
    { "target": "props.disabled", "parent": "btn_save", "change": "disabled 从 false 改为 true，提交中不可重复点击" },
    { "target": "props.loading", "parent": "btn_save", "change": "新增 loading=true，按钮内显示加载圈" }
  ],
  "preserve": ["bbox", "props.variant", "props.zIndex", "text_style"]
}
```

Rules:

- `modifications` must cover every difference between the previous visible spec
  of this component and the current update patch. Anything not listed is
  implicitly preserved; do not change unlisted parts.
- A `target` naming a child must reference a child that already exists in the
  previous spec, unless the entry's `change` explicitly starts with "新增" to
  mark a newly added child.
- Removal is still forbidden (no hide/replace). To visually retire an internal
  part, change its content or visibility props and describe that in `change`.
- An update on original page content must target the CARD/CONTAINER level, not
  a leaf: `id` is the semantic unit being versioned (an information row, card,
  or list item anchor), and the changed leaf (for example a text anchor like
  "李华-文本") appears as a modification `target` with `set_text` carrying the
  new value. Never use a bare text anchor as the update patch `id`.
- The update ledger is card-keyed: after a card is updated once, its id refers
  to the NEWEST implementation. A later state that needs that card unchanged
  simply keeps the card id; a later state changing it further writes another
  update against the same id describing only the new differences. Never
  restate earlier states' changes.

## Keep Scope: Replacement vs Overlay

Choose `inheritance.keep` based on whether the state replaces the page or floats
over it. This decision owns whether the previous page stays visible underneath.

- A full-screen replacement state (detail page, edit form, settings page, result
  or confirmation page) builds its own header and body. It MUST keep only
  system-resident areas — the system status bar (time/battery/signal) and, if
  present, the system home indicator. It MUST NOT keep the previous or initial
  page's content anchors (cards, lists, banners, tab bars, content sections, the
  old title/nav bar). Re-create whatever header and content it needs via
  `create`; never inherit the old page as a background.
- An overlay state (modal, dialog, bottom sheet, drawer, popover, context menu,
  filter panel, action menu, toast over content) floats above the page that
  triggered it. It SHOULD keep that background page's anchors so the dimmed page
  stays visible, and it MUST also `create` an overlay/mask plus the floating
  surface.
- Never put the full set of initial-page content anchors into a non-overlay
  state's `keep`. Keeping the whole initial page inside a replacement state makes
  the old page show through as a ghost background, which is a defect.
- Rule of thumb: if the state creates its own `TopNav`/title bar and fills the
  screen with new content, it is a replacement state → keep status bar only.
  If the state creates an `Overlay`/`BottomSheet`/`Dialog`/`Popover`, it is an
  overlay → keep the background page.

## State Height

Every state must output a numeric `height`.

- If all visible content fits within `viewport.initial_height`, set
  `height = viewport.initial_height`.
- If content would be cramped or clipped inside the initial viewport, allow the
  page to extend vertically. For ordinary flow content, estimate state height
  from the content group, card count, density, and vertical spacing. For fixed
  components, include their bbox bottom edge.
- `height` must be at least the largest `bbox[1] + bbox[3]` among all visible
  fixed top-level create/update components in that state.
- Every fixed top-level component bbox in a state must be authored in the
  current state's coordinate system and based on that state's `height`. Do not
  use only state_1 or `viewport.initial_height` as the vertical coordinate
  reference when the state height is larger.
- Nested child components do not need page-level bboxes. If a child needs size
  guidance, put intrinsic `width`, `height`, or documented sizing fields in
  `props`, not a page-coordinate `bbox`.
- Do not widen the page; only height may grow.
- For long product detail pages with many stacked cards, prefer increasing
  `height` over shrinking card content until it becomes empty.
- Later rendering and screenshots will use this per-state `height`, so it is the
  authoritative state canvas height.

## Content-Driven Card Layout

For ordinary page cards and sections, content drives height and page-layer
decides final placement.

Use this shape instead of fixed bbox:

```json
{
  "type": "create",
  "id": "product_info_card",
  "component": "SectionLayout",
  "layout": {
    "group": "detail_content",
    "order": 1,
    "flow": "vertical",
    "widthHint": "content-column",
    "heightMode": "auto",
    "minHeight": 180,
    "maxHeight": 360,
    "startAnchor": "below:product_image_carousel",
    "spacingHint": 12
  },
  "content_density": "rich",
  "content_requirements": ["title", "price", "coreParameters", "stockOrLeadTime", "serviceTags", "moreEntryOrPrimaryAction"],
  "props": { "variant": "card", "title": "产品信息" },
  "children": []
}
```

Rules:

- `x`, `y`, and fixed `height` are optional for ordinary page cards. Use them
  only when a concrete visual anchor exists.
- `layout.group` groups siblings that should be vertically flowed together.
- `layout.order` is the sequence inside that group.
- `layout.startAnchor` and `layout.endBeforeAnchor` express relation to kept or
  fixed components without freezing exact coordinates.
- `layout.widthHint` should be semantic, such as `content-column`,
  `full-width`, `card-grid-2`, or `safe-area`.
- `layout.heightMode` for ordinary cards should normally be `"auto"`.
- `content_density` must be one of `compact`, `normal`, or `rich`.

## Rich Card Content Rules

The state implementation model owns rich card data. Component-codegen must only
render what this model provides, so do not leave content enrichment to later
stages.

For `content_density: "rich"`:

- Include enough business fields in `props`, `visible_text`, or `children` to
  fill the intended card. Do not output a rich card that only has a title plus
  one or two text lines.
- Always include `content_requirements` as an array with at least 3 entries, and
  satisfy them with concrete fields.
- Product information cards should include at least: product title/name, price,
  core parameters, stock or lead time, service or warranty tags, and either a
  more entry or a primary action.
- After-sales/service cards should include policy, service scope, response time
  or contact/service provider, and an entry/action if applicable.
- Comment/Q&A cards should include summary counts or rating, one representative
  comment/question, and a more entry.
- Tool/grid cards should include enough items to match the declared grid
  density.
- If the blueprint lacks exact data, derive plausible business copy from the
  brief, implementation plan, registry text, and current task context. Keep it
  specific and consistent; do not use generic filler such as “内容...” or
  “示例文本”.

## Component Library Preference

When creating or updating UI components, prefer the documented components in
`component_library_reference`.

- Set `inheritance.create[].component` and `inheritance.update[].component` to a
  documented component name when the state requirement matches one, such as
  `TopNav`, `ButtonBar`, `CapsuleButton`, `InputDemo`, `StatusPill`,
  `FilterPills`, `LeftSidebar`, `ProductLayout`, `ProductCard`,
  `ProductSelectionListItem`, `CourseListItem`, `HotVideoCard`, `IconGrid`,
  `QuickEntryGrid`, `EntryCard`, `SectionLayout`, or `SectionTitle`.
- Put component configuration in `props` using prop names from the reference
  whenever possible. Keep visible copy in `text`, `visible_text`, or `props`
  fields that match the documented API.
- `props` must strictly match the component's documented props. Do not invent
  props such as `body`, `items`, `fields`, `sections`, `leftActions`, or
  `rightActions` for a component unless that exact prop is documented for that
  component.
- If the documented component does not have a prop for content, represent that
  content as `children` child patches instead of adding custom props.
- For example, `SectionLayout` props are only `variant`, `title`, `moreText`,
  `onMore`, `tabs`, `activeTab`, `onTabChange`, and `headerRightAction`;
  `SectionLayout` content must be represented as `children`, not `props.body`.
- Use custom component/container names only when no documented component fits
  the required UI. If using a custom name, add a short `description` explaining
  why the component library is insufficient.
- Do not invent props for documented components when a documented prop already
  covers the same need.
- Do not use component-library names for incompatible UI. For example, use
  `FilterPills` for filtering chips, `UnderlineTabs` for navigation tabs,
  `ButtonBar` for bottom action groups, and `InputDemo` for line-style form
  inputs.
- When `component_library_reference` documents a default width, height, or bbox
  recommendation, use that size as the starting point for top-level `bbox` or
  nested child `props.width` / `props.height`. Do not stretch fixed-size
  components to fill unrelated containers. If the design needs a larger area,
  create or keep a separate container/shell and place the fixed-size component
  inside it.
- For documented fixed-size components, keep top-level bbox or nested intrinsic
  size compatible with the component: for example `ProductCard` is 264 x 90,
  `EntryCard` defaults to 158 x 58, `TopNav` is 360 x 56, `BottomNav` is
  360 x 64, and `ButtonBar` is a 360-wide action area with 40px buttons inside
  (it is pinned to the screen bottom only when you give it bottom intent — see
  the bottom-bar rules above; otherwise it flows inline at its authored
  position).

## Overlay And Sheet Composition

For modal, drawer, popup, and bottom-sheet states, use a simple two-layer
composition:

1. Create one overlay/mask component for the dim background.
2. Create one complete sheet/dialog component that owns its header, title,
   close action, clear action, body content, footer, and primary button.

Do not split a single BottomSheet/Drawer/Modal into separate child create
patches such as `sheet_header`, `risk_tip`, `product_item`, `total_price`, or
`footer_button` unless those children are independently animated or reused in a
later state. Prefer one full `BottomSheet` create patch with structured `props`.

Required z-index convention:

- Overlay/mask: `props.zIndex: 50`
- Sheet/dialog/popup: `props.zIndex: 60` or higher
- Floating toast above sheet: `props.zIndex: 70` or higher

Toast/Snackbar feedback is fixed non-blocking feedback and does not require a
global mask/overlay unless the blueprint explicitly asks for a blocking
confirmation dialog.

The overlay must never visually cover the sheet. Put z-index values in `props`
so component-codegen can render them as inline `zIndex`.

BottomSheet bbox rule:

- BottomSheet bbox must be placed at the bottom of the current state canvas.
- Use the current state's `height`, not the initial state height, when computing
  bottom alignment.
- For a bottom-aligned sheet, `bbox[1] + bbox[3]` must equal `state.height`.
- Example: if `state.height = 1176` and the sheet height is `336`, use
  `bbox: [0, 840, 360, 336]`.
- Do not rely on page-layer post-processing to move or resize BottomSheet.

Container height and bbox rule:

- Only viewport-edge surfaces need a hard, edge-aligned fixed `bbox` height:
  `BottomSheet`, bottom action bar, soft keyboard, top nav, status bar, and
  full-screen `Overlay`/mask. These keep the existing fixed-bbox rules above.
- Centered overlay containers — `Dialog`, centered `Modal`, `Popover` — and
  ordinary content cards must NOT invent an arbitrary fixed `bbox` height. A
  too-small fixed height clips the container's own header, body, or footer (for
  example a `Dialog` whose footer buttons disappear under `overflow:hidden`).
- For a centered overlay container whose exact pixel height is not dictated by a
  viewport edge, set `props.heightMode: "auto"` so content drives the height,
  and give `bbox` as `[x, y, width, minHeight]` where `minHeight` is a sensible
  LOWER bound. With `heightMode:"auto"` the container renders at least
  `minHeight` tall and grows taller when its content needs more room, so it
  never clips its header, body, or footer. Choose `minHeight` generously enough
  to fit the expected header + body + footer; do not freeze `bbox[3]` to a tight
  guessed height. `props.maxHeight` is optional.
- If you nonetheless provide a fixed `bbox` height for a container that has
  `children`, `bbox[3]` MUST be large enough to render the full header + body +
  footer. The internal footer of a `Dialog`/`Sheet` must never be clipped.
- A `Dialog`/`Sheet` footer (its action buttons) is an INTERNAL child of the
  container. Author it inside the container's `children`, never as a separate
  top-level create or update patch.

Stacked modal rule:

- If a state inherits an existing modal, drawer, bottom sheet, dialog, or popup
  from its parent state and creates a new higher-level modal/sheet/dialog, it
  must also create a new overlay/mask for the new layer.
- The new overlay must cover the previous modal/sheet/dialog content, not just
  the base page.
- The new overlay z-index must be between the inherited modal and the new modal.
  For example, inherited sheet `zIndex: 60`, new overlay `zIndex: 65`, new sheet
  `zIndex: 70`.
- Do not reuse the parent state's overlay as the only overlay for stacked
  modal states.
- Every modal/sheet/drawer/dialog layer must have a global mask/overlay
  component. The mask z-index must be lower than its own sheet/dialog, but
  higher than all content it is meant to dim.
- For a second-level modal over a first-level modal, the second-level mask must
  have a z-index higher than the first-level sheet/dialog so it visually covers
  the first-level modal. The second-level sheet/dialog must have an even higher
  z-index than the second-level mask.

Container children rule:

- For container components such as `SectionLayout`, `Card`, `List`,
  `BottomSheet`, `Drawer`, `Modal`, and `Dialog`, include structured `children`
  when the implementation plan describes internal content.
- A container with child content must not only contain `title`; it must express
  the internal elements as `children` unless the component's documented props
  include a specific content prop.
- Container components must not use top-level `text` as a substitute for child
  content. For `SectionLayout`, `Card`, `List`, `BottomSheet`, `Drawer`,
  `Modal`, and `Dialog`, put implementation details under `children` unless a
  documented prop explicitly supports that content. Top-level `text` is only
  for simple leaf components such as `Text`, `CapsuleButton`, `StatusPill`, or
  icon labels.
- `SectionLayout` is a documented component whose content is the React
  `children` prop. Therefore every `SectionLayout` patch must include a
  non-empty `children` array. Do not output `children: []` for `SectionLayout`
  when the implementation plan describes card content.
- Prefer `children` when child elements need their own component type, bbox,
  props, text, or text style.
- Container `children` are authored by the state model and generated by
  component-codegen as independent React components first. The parent component
  imports those generated children and composes them through normal React
  `children` or explicit layout slots.
- Parent containers must not rewrite the real child content. They should render
  only the container background, header, spacing, and layout, then place imported
  child components in the appropriate content area.
- Custom containers should render only their shell/background/layout and import
  their children. They should not duplicate child text, list rows, buttons, or
  card bodies.
- Child patches must still follow the same component-library preference,
  typography, documented props, and visible text rules as top-level create
  patches, but child patches should avoid page-coordinate `bbox` unless the
  child is truly floating independently of the parent.

For a full BottomSheet patch, include structured props such as:

```json
{
  "title": "产品清单",
  "showClose": true,
  "clearText": "全部清空",
  "body": [
    { "type": "warning", "text": "风险提示：当前方案可能缺少关键设备" },
    { "type": "product", "name": "IdeaHub B2 Base-75寸", "price": "¥21,999", "quantity": 1 },
    { "type": "entry", "title": "推荐配件", "subtitle": "查看相关配件" }
  ],
  "footer": { "totalText": "合计：¥21,999", "primaryLabel": "去配单" },
  "zIndex": 60
}
```

## Text Style Attributes

For every component that contains visible `text`, `visible_text`, labels, titles,
button copy, or body copy, include text style metadata using tokens from
`global.css`.

Use either `text_style` for a single text component or `props.textStyles` for
multiple named text slots.

Recommended shape:

```json
{
  "text": "加入配单",
  "text_style": {
    "className": "font-headline-s",
    "fontSize": "var(--font-headline-16)",
    "lineHeight": "var(--line-height-20)",
    "fontWeight": "var(--font-weight-medium)",
    "color": "var(--color-text-white)"
  }
}
```

Use these defaults unless the component library reference says otherwise:

- Major page title: `font-headline-xxl`
- Card title / section title / primary button: `font-headline-s`
- Secondary label / compact title: `font-headline-xs`
- Body copy: `font-body-m`
- Small secondary copy: `font-caption-m`
- Tiny tag/status copy: `font-caption-s`

## Patch Types

- `bind`: connect an original or virtual anchor to `goto:state_N`
- `keep`: do not use as a patch; put anchors in `inheritance.keep`
- `create`: describe new UI to create; put patches in `inheritance.create`
- `update`: update content/state of an anchor; put patches in
  `inheritance.update`, each with an expanded `modifications` / `preserve`
  change plan

## Validation Checklist

- Every non-`state_1` state has `parent_state`.
- `state_1.trigger` is `null`; first-screen outbound clicks are represented by
  `state_1.patches[].bind`.
- Every click/tap trigger on a non-initial state has `goto` equal to that
  state's own `id`.
- Every `bind` patch has an explicit `goto: "state_N"` target.
- Every trigger anchor exists in original anchors or previous virtual anchors,
  unless it is a system trigger such as `timeout`, `data_loaded`, or
  `submit_success`.
- Every keep/update target exists in original anchors or previous virtual
  anchors.
- Every update patch has a non-empty `modifications` array whose entries all
  include `target` and `change`, plus a `preserve` array for untouched parts.
- No `inheritance.update` target id is a component that was created as a child
  inside a container; container-internal changes update the owning top-level
  container instead.
- Every centered overlay container (`Dialog`/`Modal`/`Popover`) and card that
  carries `children` either sets `props.heightMode:"auto"` or provides a fixed
  bbox height large enough to contain header + body + footer.
- Every non-modal create/update bbox avoids all kept bboxes for the state.
- No `hide`, `replace`, `inheritance.hide`, or `inheritance.replace` is present.
- No create visible text equals internal labels such as `state_2` or an internal
  Chinese state label ending with `态`.
