#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadSkillEnv,
  configureNodePath,
  resolveArgPath,
  exists,
} = require("../../../../../scripts/paths");
const { callJsonChat, resolveTextModel } = require("../../../../../scripts/llm_config");

function readUtf8(file) {
  return fs.readFileSync(file, "utf8");
}

function writeUtf8(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
}

function stateNum(id) {
  const match = String(id || "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function stripThink(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJson(text) {
  let source = stripThink(text);
  const markdown = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (markdown) source = markdown[1].trim();
  const json = source.match(/\{[\s\S]*\}/);
  if (json) source = json[0];
  return JSON.parse(source);
}

function latestBlueprint(base) {
  const dir = path.join(base, "html");
  const hits = [];
  function walk(current) {
    if (!fs.existsSync(current)) return;
    for (const name of fs.readdirSync(current)) {
      const file = path.join(current, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) walk(file);
      else if (name === "blueprint_builder_input.json") hits.push(file);
    }
  }
  walk(dir);
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0];
}

function compactTreeNode(node) {
  if (!node || typeof node !== "object") return null;
  return {
    anchor: node.anchor || node.name || null,
    selector: node.selector || null,
    id: node.id || null,
    area: node.area || null,
    component: node.component || node.semantic || null,
    element: node.element || node.range || null,
    bbox: Array.isArray(node.bbox) ? node.bbox : null,
    text: node.text || "",
    policy: node.policy || node.inheritance_policy || null,
    confidence: node.confidence || null,
    children: (node.children || []).map(compactTreeNode).filter(Boolean),
  };
}

function treeRegistryFromGraph(registry) {
  const graph = registry.semantic_dom_tree;
  const graphNodes = graph?.nodes || {};
  const roots = graph?.roots || [];
  const build = (name) => {
    const node = graphNodes[name];
    if (!node) return null;
    return compactTreeNode({
      ...node,
      anchor: node.anchor || name,
      children: (node.children || []).map(build).filter(Boolean),
    });
  };
  return { type: "tree", roots: roots.map(build).filter(Boolean) };
}

function treeRegistryFromFlat(registry) {
  const roots = Object.entries(registry.semantic_dom_registry || {}).map(([name, entry]) => compactTreeNode({
    anchor: name,
    selector: entry.selector,
    id: entry.id,
    area: entry.area,
    component: entry.component || entry.semantic,
    element: entry.element || entry.range,
    bbox: entry.bbox,
    text: entry.text,
    policy: entry.inheritance_policy,
    confidence: entry.confidence,
    children: [],
  })).filter(Boolean);
  return { type: "tree", roots };
}

function semanticRegistryForPrompt(registry) {
  if (registry.semantic_registry_tree?.type === "tree" && Array.isArray(registry.semantic_registry_tree.roots)) {
    return {
      type: "tree",
      roots: registry.semantic_registry_tree.roots.map(compactTreeNode).filter(Boolean),
    };
  }
  if (registry.semantic_dom_tree?.nodes && Array.isArray(registry.semantic_dom_tree.roots)) {
    return treeRegistryFromGraph(registry);
  }
  return treeRegistryFromFlat(registry);
}

function layoutConstraints() {
  return [
    "Ordinary page cards should use weak layout hints instead of fixed bbox: layout.group, layout.order, layout.flow, layout.widthHint, layout.heightMode:auto, layout.startAnchor, and layout.spacingHint.",
    "Ordinary page cards should not invent exact x/y/height unless there is a clear visual anchor, fixed start point, two-column grid, sticky/floating behavior, or edge alignment requirement.",
    "Fixed containers must use bbox: Overlay, mask, BottomSheet, Drawer, Modal, Dialog, Toast, top nav, bottom bar, and floating action bars.",
    "If a state keeps a top/status anchor, fixed created content must start below that anchor bbox unless it is an intentional transparent/hero background; flow cards should use layout.startAnchor.",
    "If a state keeps a bottom/nav anchor, fixed created content must end above that anchor bbox; flow cards should use layout.endBeforeAnchor or a scrollable content group.",
    "If the state is not a modal, drawer, popover, toast, or overlay, every fixed created component bbox must avoid overlap with kept bboxes.",
    "Fixed body regions at the same z-index must be bbox-mutually exclusive. Status/top/nav/body/bottom regions must not overlap unless one is a higher-z overlay/modal/sheet or an intentional transparent hero background.",
    "Every modal/sheet/drawer/dialog layer must have its own global overlay/mask. Overlay z-index must be lower than its own surface and higher than content it dims.",
    "Toast is fixed feedback and does not require a global overlay/mask unless the blueprint explicitly asks for a blocking dialog.",
    "For stacked modals, the second-level overlay z-index must be higher than the first-level sheet/dialog z-index, and the second-level sheet/dialog z-index must be higher than the second-level overlay.",
    "Do not output hide or replace. The implementation model only contains keep, create, and update.",
    "Generated UI should support an antd Mobile visual style and Gestalt grouping.",
    "Prefer component names and props from component_library_reference. Use other component/container names only when no documented component fits the state requirement.",
    "Only top-level create/update patches need page-coordinate bbox. Children inside containers should describe their own props/text/intrinsic width/height instead of bbox.",
    "Parent containers own page placement and child layout. Child components are generated first and imported by the parent during codegen.",
    "Rich cards must be fully populated in state_implementation_model. Component-codegen only renders existing props/children/text and must not invent business data.",
    "For every state after state_1, first consider the previous state's full visible set: original kept anchors, previous create/update components, and components inherited from earlier ancestors. Keep or update the items that remain visible; create only newly introduced items.",
    "For modal, drawer, popup, and bottom-sheet states, keep the background state's visible components behind the overlay, including persistent status/system bar anchors when present in semantic_registry.",
    "If a state jumps back to an earlier page such as home/list, consider that earlier state's full accumulated visible set, not only its direct create patches.",
  ];
}

function componentLibraryReference() {
  const file = path.resolve(__dirname, "../../../resources/components/README.md");
  if (!fs.existsSync(file)) return "";
  return readUtf8(file);
}

function ownString(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) && typeof obj[key] === "string" ? obj[key] : null;
}

function patchAnchor(patch) {
  return ownString(patch, "target_anchor") || ownString(patch, "anchor") || ownString(patch, "target") || ownString(patch, "id") || null;
}

// LLMs sometimes express an automatic transition as a bind patch with a
// pseudo anchor like "system"/"auto". The transition is already carried by the
// target state's trigger; such binds can never attach to a DOM element.
function gotoStateNum(value) {
  const match = String(value || "").match(/state[_-]?(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function isClickAction(action) {
  // Long-press degrades to a click: the static prototype cannot listen for a
  // real long-press, so it is treated as a tap/click trigger.
  return /(^|:)click$/i.test(String(action || "")) || /^tap$/i.test(String(action || ""))
    || /long[\s_-]?press|长按/i.test(String(action || ""));
}

// Outbound trigger model: a state advances to the next state by either a user
// interaction on an anchor (always bound as a CLICK — taps, long-press, drag,
// swipe, selecting an option, or "filling" an input all collapse to one click;
// no real text/gesture input is captured) or by an automatic timed transition
// ("wait": loading→loaded, submitting→success, toast auto-dismiss, splash→home).
function triggerActionKind(action) {
  const a = String(action || "").trim().toLowerCase();
  if (!a) return "click";
  if (/^wait$/.test(a)
    || /timeout|data_loaded|load(ing|_complete)?|submit_success|success|system|auto|delay|完成|系统|自动|加载|提交中|等待|延时/.test(a)) {
    return "wait";
  }
  return "click";
}

// Normalize one outbound trigger to {anchor?, action, goto, target?}. Returns
// null when it carries no usable destination.
function normalizeOutboundTrigger(raw, idToAnchor) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const action = triggerActionKind(raw.action || raw.event);
  const gotoNum = gotoStateNum(raw.goto) || gotoStateNum(raw.action) || gotoStateNum(raw.target_state);
  if (!gotoNum) return null;
  const out = { action, goto: `state_${gotoNum}` };
  if (action !== "wait") {
    let anchor = ownString(raw, "anchor") || ownString(raw, "target_anchor");
    if (typeof anchor === "string") anchor = normalizeAnchorValue(anchor, idToAnchor);
    if (anchor) out.anchor = anchor;
    const target = raw.target != null && typeof raw.target !== "object" ? String(raw.target).trim() : "";
    if (target) out.target = target;
  }
  return out;
}

function dedupeTriggers(triggers) {
  const seen = new Set();
  const out = [];
  for (const trig of triggers) {
    if (!trig) continue;
    const key = `${trig.action}|${trig.anchor || ""}|${trig.goto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trig);
  }
  return out;
}

function registryIdToAnchorMap(registry) {
  const map = new Map();
  for (const [anchor, entry] of Object.entries(registry.semantic_dom_registry || {})) {
    if (entry?.id) map.set(String(entry.id), anchor);
    if (typeof entry?.selector === "string" && entry.selector.startsWith("#")) {
      map.set(entry.selector.slice(1), anchor);
    }
  }
  return map;
}

function normalizeAnchorValue(value, idToAnchor) {
  if (typeof value !== "string") return value;
  if (idToAnchor.has(value)) return idToAnchor.get(value);
  // Selector form (#id) that the model sometimes emits instead of the id.
  if (value.startsWith("#") && idToAnchor.has(value.slice(1))) return idToAnchor.get(value.slice(1));
  const relation = value.match(/^(below|above|leftOf|rightOf|after|before):(.+)$/);
  if (relation && idToAnchor.has(relation[2])) return `${relation[1]}:${idToAnchor.get(relation[2])}`;
  return value;
}

function normalizePatchAnchorRefs(patch, idToAnchor) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  // Also normalize `id`: an update patch targeting an original DOM anchor may
  // carry the raw element id (or #id) as its id. Virtual component ids are not
  // in the map and pass through unchanged.
  for (const key of ["anchor", "target_anchor", "id"]) {
    if (typeof patch[key] === "string") patch[key] = normalizeAnchorValue(patch[key], idToAnchor);
  }
  if (patch.layout && typeof patch.layout === "object" && !Array.isArray(patch.layout)) {
    for (const key of ["startAnchor", "endBeforeAnchor"]) {
      if (typeof patch.layout[key] === "string") patch.layout[key] = normalizeAnchorValue(patch.layout[key], idToAnchor);
    }
  }
  for (const child of patchChildren(patch)) normalizePatchAnchorRefs(child, idToAnchor);
}

function normalizeRichRequirements(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  if (String(patch.content_density || "").toLowerCase() === "rich") {
    const requirements = Array.isArray(patch.content_requirements) ? patch.content_requirements.filter(Boolean) : [];
    const fallback = ["primaryContent", "supportingContent", "actionOrMetadata"];
    for (const item of fallback) {
      if (requirements.length >= 3) break;
      if (!requirements.includes(item)) requirements.push(item);
    }
    patch.content_requirements = requirements;
  }
  for (const child of patchChildren(patch)) normalizeRichRequirements(child);
}

function patchBottom(patch) {
  const bbox = Array.isArray(patch?.bbox) ? patch.bbox.map(Number) : [];
  const y = Number.isFinite(bbox[1]) ? bbox[1] : null;
  const h = Number.isFinite(bbox[3]) ? bbox[3] : null;
  return y == null || h == null ? 0 : y + h;
}

function patchChildren(patch) {
  return Array.isArray(patch?.children) ? patch.children : [];
}

function collectPatchIds(patch, out = []) {
  const id = patch?.id || patch?.name;
  if (id) out.push(id);
  for (const child of patchChildren(patch)) collectPatchIds(child, out);
  return out;
}

function registerPatchTree(patch, map) {
  const id = patch?.id || patch?.name;
  if (id) map.set(id, patch);
  for (const child of patchChildren(patch)) registerPatchTree(child, map);
}

function collectPatchRefs(patch, out = []) {
  const anchor = patchAnchor(patch);
  if (anchor) out.push(anchor);
  for (const child of patchChildren(patch)) collectPatchRefs(child, out);
  return out;
}

function collectTopLevelPatchIds(patch, out = []) {
  const id = patch?.id || patch?.name;
  if (id) out.push(id);
  return out;
}

function isContainerLike(patch) {
  return /sectionlayout|card|list|bottomsheet|drawer|modal|dialog|container|panel|wrapper|shell/i.test(String(patch?.component || patch?.id || ""));
}

function isFixedPlacementComponent(patch) {
  const value = `${patch?.component || ""} ${patch?.id || ""}`.toLowerCase();
  return /bottomsheet|drawer|modal|dialog|toast|popover|overlay|mask|topnav|bottomnav|buttonbar|bottom[_-]?bar|action[_-]?bar|tab[_-]?bar|floating|statusbar|softkeyboard|keyboard|ime/.test(value);
}

function isKeyboardPatch(patch) {
  return /softkeyboard|keyboard|ime|软键盘|键盘/i.test(`${patch?.component || ""} ${patch?.id || ""}`);
}

function isBottomActionPatch(patch) {
  return /buttonbar|bottomnav|bottom[_-]?bar|action[_-]?bar|footer[_-]?bar|底部.*按钮|底部.*操作/i.test(`${patch?.component || ""} ${patch?.id || ""}`);
}

function explicitFixedBottomRole(patch) {
  const role = String(patch?.props?.layoutRole || "").toLowerCase();
  return role === "fixed-bottom-action" || role === "fixed-bottom-keyboard";
}

// Height-independent signals that a bottom-bar-type component is genuinely a
// viewport-pinned bar (BottomNav, an explicitly named bottom/action bar, or an
// explicit layoutRole), as opposed to an inline `ButtonBar` action row that
// merely lives somewhere in the page flow.
function namedViewportBottomBar(patch) {
  if (explicitFixedBottomRole(patch)) return true;
  if (/^bottomnav$/i.test(String(patch?.component || ""))) return true;
  return /(^|[_-])bottom([_-]|$)|底部|bottom[_-]?bar|action[_-]?bar|footer[_-]?bar/i.test(String(patch?.id || patch?.name || ""));
}

// A bbox the author placed flush against the bottom of the state canvas is a
// strong signal the bar is meant to be pinned there.
function authoredFlushAtBottom(patch, refHeight) {
  const bbox = Array.isArray(patch?.bbox) ? patch.bbox.map(Number) : [];
  if (bbox.length !== 4 || !bbox.every(Number.isFinite)) return false;
  const ref = Number(refHeight) || 0;
  if (!ref) return false;
  const bottom = bbox[1] + bbox[3];
  return bbox[1] > ref * 0.5 && Math.abs(bottom - ref) <= 24;
}

// Whether a bottom-action candidate should be coerced to the viewport bottom.
// A bare `ButtonBar` with no bottom intent is an inline action row and must be
// left in the page flow (this is the class-1 fix: stop pinning every ButtonBar
// to the screen bottom).
function intendsViewportBottomBar(patch, refHeight) {
  return namedViewportBottomBar(patch) || authoredFlushAtBottom(patch, refHeight);
}

function normalizeFixedViewportPatch(patch, initialHeight, stateHeight) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  const viewportHeight = Number(initialHeight) || 936;
  const bottomRef = Number(stateHeight) || viewportHeight;
  const bbox = Array.isArray(patch.bbox) ? patch.bbox.map(Number) : [];
  if (isKeyboardPatch(patch)) {
    const width = Number.isFinite(bbox[2]) && bbox[2] > 0 ? bbox[2] : 360;
    const height = Number.isFinite(bbox[3]) && bbox[3] > 0 ? bbox[3] : 336;
    patch.bbox = [0, Math.max(0, viewportHeight - height), width, height];
    patch.props = { ...(patch.props || {}), layoutRole: "fixed-bottom-keyboard", zIndex: Math.max(Number(patch.props?.zIndex || 0), 90) };
  } else if (isBottomActionPatch(patch) && intendsViewportBottomBar(patch, bottomRef)) {
    const width = Number.isFinite(bbox[2]) && bbox[2] > 0 ? bbox[2] : 360;
    const height = Number.isFinite(bbox[3]) && bbox[3] > 0 ? bbox[3] : 64;
    patch.bbox = [0, Math.max(0, viewportHeight - height), width, height];
    patch.props = { ...(patch.props || {}), layoutRole: "fixed-bottom-action", zIndex: Math.max(Number(patch.props?.zIndex || 0), 80) };
  }
}

function mergeVirtualPlacement(patch, virtualPatchById) {
  const id = patch?.id || patch?.name;
  if (!id || !virtualPatchById.has(id)) return;
  const previous = virtualPatchById.get(id) || {};
  if (!patch.component && previous.component) patch.component = previous.component;
  if (!Array.isArray(patch.bbox) && Array.isArray(previous.bbox)) patch.bbox = previous.bbox.slice();
  if (!patch.layout && previous.layout) patch.layout = { ...previous.layout };
  patch.props = { ...(previous.props || {}), ...(patch.props || {}) };
}

// --- Update patch modification list -----------------------------------------
// Every update patch must carry an expanded change plan: `modifications`
// (which internal parts of the updated component change, and how) and
// `preserve` (which parts must stay exactly as the previous implementation).
// The LLM is asked to author these directly; when it does not, they are
// derived deterministically by diffing the merged update patch against the
// previous spec (virtual component from an earlier state, or the original
// registry anchor).

const MODIFICATION_KEY_ALIASES = ["modifications", "modification_list", "changes", "update_plan", "修改列表"];
const PRESERVE_KEY_ALIASES = ["preserve", "preserved", "unchanged", "keep_parts", "保留列表"];

// Machine-applicable value fields. `change` stays the human/LLM-facing plan;
// set_* carry the concrete new values so the deterministic renderer (clone +
// apply) can execute simple modifications without an LLM call.
const MODIFICATION_SET_FIELDS = ["set_text", "set_text_style", "set_bbox", "set_props"];
const MODIFICATION_SET_ALIASES = { new_text: "set_text", to_text: "set_text", new_text_style: "set_text_style", new_bbox: "set_bbox" };

function makeModification(target, targetComponent, parent, change) {
  const entry = { target: String(target || "").trim(), parent: parent || null, change: String(change || "").trim() };
  if (targetComponent) entry.target_component = String(targetComponent).trim();
  return entry.target && entry.change ? entry : null;
}

function copyModificationSetFields(source, entry) {
  if (!source || !entry || typeof source !== "object") return entry;
  for (const field of MODIFICATION_SET_FIELDS) {
    if (source[field] !== undefined) entry[field] = source[field];
  }
  for (const [alias, field] of Object.entries(MODIFICATION_SET_ALIASES)) {
    if (source[alias] !== undefined && entry[field] === undefined) entry[field] = source[alias];
  }
  return entry;
}

// "子id/子组件名/父组件名" → { target, target_component, parent }
function parseModificationTarget(raw) {
  const parts = String(raw || "").split("/").map((item) => item.trim()).filter(Boolean);
  return { target: parts[0] || "", target_component: parts[1] || null, parent: parts[2] || null };
}

function normalizeModificationEntry(entry, parentId) {
  if (typeof entry === "string") {
    const match = entry.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!match) return null;
    const parsed = parseModificationTarget(match[1]);
    return makeModification(parsed.target, parsed.target_component, parsed.parent || parentId, match[2]);
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const change = entry.change || entry.plan || entry["修改方案"] || entry["方案"];
  const target = entry.target || entry.child || entry.path || entry["目标"] || entry["子组件"];
  if (typeof target === "string" && typeof change === "string") {
    const parsed = parseModificationTarget(target);
    const made = copyModificationSetFields(entry, makeModification(
      parsed.target,
      entry.target_component || entry.component || parsed.target_component,
      entry.parent || parsed.parent || parentId,
      change
    ));
    if (made && typeof entry.type === "string" && /^(create|update|delete)$/i.test(entry.type.trim())) {
      made.type = entry.type.trim().toLowerCase();
    }
    return made;
  }
  const keys = Object.keys(entry);
  if (keys.length === 1 && typeof entry[keys[0]] === "string") {
    const parsed = parseModificationTarget(keys[0]);
    return makeModification(parsed.target, parsed.target_component, parsed.parent || parentId, entry[keys[0]]);
  }
  return null;
}

// A modification whose target is one of the container's OWN fields (not a
// child component). Child-component targets get a create/update `type`.
const MODIFICATION_FIELD_TARGET = /^(self|text|text_style|bbox|layout|props($|\.)|children$)/i;

function modificationChildTarget(target) {
  const t = String(target || "").trim().replace(/^children\./, "");
  return t.split(".")[0].trim();
}

function isChildModification(mod) {
  const target = String(mod?.target || "").trim();
  if (!target) return false;
  return !MODIFICATION_FIELD_TARGET.test(target);
}

// Container's OWN field targets (no child component involved).
const MODIFICATION_SELF_FIELD = /^(self|text|text_style|bbox|layout|props)($|\.|\[)/i;

// Fold the (target, parent) pair into a single canonical `target` path and drop
// `parent`. A child component is addressed as "children.<id>"; a field on that
// child as "children.<id>.props.x" / ".text" / ".bbox"; a grandchild as
// "children.<id>.children.<id2>". A container's own field stays "props.x" /
// "text" / "bbox" / etc. `parent` is redundant once the path is complete — the
// component tree already encodes ownership — so it is removed.
function canonicalizeModificationTarget(mod, containerId) {
  if (!mod || typeof mod !== "object") return;
  let target = String(mod.target || "").trim();
  const parent = String(mod.parent || "").trim();
  const parentIsChild = Boolean(parent) && parent !== containerId;
  const isField = target === "self" || MODIFICATION_SELF_FIELD.test(target);
  if (parentIsChild) {
    if (isField) {
      target = target === "self" ? `children.${parent}` : `children.${parent}.${target}`;
    } else {
      // `target` may be a bare child id ("radio_time") OR a path that already
      // includes the parent segment ("section_time.children.radio_time" or
      // "children.section_time.children.radio_time"). Only prepend the parent
      // wrapper when it is not already present; otherwise the parent segment is
      // duplicated, e.g. children.section_time.children.section_time.children.radio_time.
      const bare = target.replace(/^children\./, "");
      target = (bare === parent || bare.startsWith(`${parent}.`))
        ? `children.${bare}`
        : `children.${parent}.children.${bare}`;
    }
  } else if (target && !isField) {
    target = `children.${target.replace(/^children\./, "")}`;
  }
  mod.target = target;
  delete mod.parent;
}

// Stamp every modification with `type`: "create" for a brand-new child
// component (not present in the previous implementation), "update" for a
// change to a child/field that already existed, or "delete" to remove an
// existing child component from the container. Only a previously-rendered
// component may be updated/deleted; a new sub-component must be created. The
// component-codegen step relies on this to decide whether to regenerate the
// parent so the new/removed child is actually inserted/dropped. An
// author-supplied type wins.
function annotateModificationTypes(modifications, previousSpec) {
  const prevChildIds = new Set(
    patchChildren(previousSpec).map((child) => child?.id || child?.name).filter(Boolean)
  );
  for (const mod of modifications) {
    if (!mod || typeof mod !== "object") continue;
    if (mod.type === "create" || mod.type === "update" || mod.type === "delete") continue;
    if (isChildModification(mod)) {
      mod.type = prevChildIds.has(modificationChildTarget(mod.target)) ? "update" : "create";
    } else {
      mod.type = "update";
    }
  }
  return modifications;
}

function shortValueText(value) {
  if (value == null) return "null";
  const text = typeof value === "string" ? `「${value}」` : JSON.stringify(value);
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Direct child specs of an original registry anchor, read from the semantic DOM
// tree. Seeds previousSpec.children so a modification targeting an existing
// original child is typed as `update`, not mistaken for a brand-new `create`.
function registryChildrenOf(registry, anchorId) {
  if (!anchorId) return [];
  const out = [];
  const nodes = registry?.semantic_dom_tree?.nodes;
  if (nodes && typeof nodes === "object") {
    const node = nodes[anchorId];
    for (const cid of Array.isArray(node?.children) ? node.children : []) {
      const child = nodes[cid] || {};
      out.push({ id: cid, component: child.component || child.semantic || null });
    }
    if (out.length) return out;
  }
  const roots = registry?.semantic_registry_tree?.roots;
  if (Array.isArray(roots)) {
    const find = (list) => {
      for (const n of list || []) {
        if ((n?.anchor || n?.name) === anchorId) return n;
        const hit = find(n?.children);
        if (hit) return hit;
      }
      return null;
    };
    const node = find(roots);
    for (const c of node?.children || []) {
      const a = c?.anchor || c?.name;
      if (a) out.push({ id: a, component: c.component || c.semantic || null });
    }
  }
  return out;
}

function previousSpecForUpdate(patch, virtualPatchById, registry, idToAnchor) {
  const rawId = patch?.id || patch?.name;
  if (!rawId) return null;
  if (virtualPatchById.has(rawId)) return virtualPatchById.get(rawId);
  const id = normalizeAnchorValue(rawId, idToAnchor);
  if (virtualPatchById.has(id)) return virtualPatchById.get(id);
  const entry = registry.semantic_dom_registry?.[id] || registry.semantic_dom_registry?.[rawId];
  if (!entry) return null;
  return {
    id,
    component: entry.component || entry.semantic || null,
    text: typeof entry.text === "string" ? entry.text : "",
    bbox: Array.isArray(entry.bbox) ? entry.bbox : undefined,
    props: {},
    children: registryChildrenOf(registry, id),
  };
}

function diffUpdateModifications(patch, previousSpec) {
  const parent = patch.id || patch.name || null;
  const prev = previousSpec || {};
  const mods = [];
  if (typeof patch.text === "string" && patch.text.trim() && patch.text !== prev.text) {
    mods.push(copyModificationSetFields({ set_text: patch.text }, makeModification("text", null, parent,
      typeof prev.text === "string" && prev.text.trim()
        ? `文本从${shortValueText(prev.text)}改为${shortValueText(patch.text)}`
        : `文本设为${shortValueText(patch.text)}`)));
  }
  if (patch.text_style && !sameJson(patch.text_style, prev.text_style) && prev.text_style) {
    mods.push(copyModificationSetFields({ set_text_style: patch.text_style },
      makeModification("text_style", null, parent, `文字样式更新为 ${shortValueText(patch.text_style)}`)));
  }
  const prevProps = prev.props || {};
  for (const [key, value] of Object.entries(patch.props || {})) {
    if (sameJson(prevProps[key], value)) continue;
    mods.push(copyModificationSetFields({ set_props: { [key]: value } }, makeModification(`props.${key}`, null, parent,
      prevProps[key] === undefined
        ? `新增 ${key}=${shortValueText(value)}`
        : `${key} 从 ${shortValueText(prevProps[key])} 改为 ${shortValueText(value)}`)));
  }
  if (Array.isArray(patch.bbox) && Array.isArray(prev.bbox) && !sameJson(patch.bbox, prev.bbox)) {
    mods.push(copyModificationSetFields({ set_bbox: patch.bbox },
      makeModification("bbox", null, parent, `位置/尺寸从 ${JSON.stringify(prev.bbox)} 改为 ${JSON.stringify(patch.bbox)}`)));
  }
  if (patch.layout && prev.layout && !sameJson(patch.layout, prev.layout)) {
    mods.push(makeModification("layout", null, parent, `布局提示更新为 ${shortValueText(patch.layout)}`));
  }
  const prevChildren = new Map(patchChildren(prev).map((child) => [child?.id || child?.name, child]).filter(([id]) => id));
  for (const child of patchChildren(patch)) {
    const childId = child?.id || child?.name;
    if (!childId) continue;
    if (!prevChildren.has(childId)) {
      const mod = makeModification(childId, child.component || null, parent, "新增子组件");
      if (mod) mod.type = "create";
      mods.push(mod);
    } else if (!sameJson(prevChildren.get(childId), child)) {
      const mod = makeModification(childId, child.component || prevChildren.get(childId)?.component || null, parent, "子组件内容/属性更新，按当前 patch 重渲染该子组件");
      if (mod) mod.type = "update";
      mods.push(mod);
    }
  }
  return mods.filter(Boolean);
}

function derivePreserve(patch, previousSpec, modifications) {
  const touched = new Set(modifications.map((mod) => String(mod?.target || "")));
  const prev = previousSpec || {};
  const preserve = [];
  for (const key of Object.keys(prev.props || {})) {
    if (!touched.has(`props.${key}`)) preserve.push(`props.${key}`);
  }
  if (typeof prev.text === "string" && prev.text.trim() && !touched.has("text")) preserve.push("text");
  if (prev.text_style && !touched.has("text_style")) preserve.push("text_style");
  if (Array.isArray(prev.bbox) && !touched.has("bbox")) preserve.push("bbox");
  if (prev.layout && !touched.has("layout")) preserve.push("layout");
  for (const child of patchChildren(prev)) {
    const childId = child?.id || child?.name;
    if (childId && !touched.has(childId)) preserve.push(childId);
  }
  return preserve;
}

function normalizeUpdateModifications(patch, previousSpec, idToAnchor = new Map()) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  const parent = patch.id || patch.name || null;
  let rawList = null;
  for (const key of MODIFICATION_KEY_ALIASES) {
    if (Array.isArray(patch[key])) {
      rawList = patch[key];
      if (key !== "modifications") delete patch[key];
      break;
    }
  }
  let modifications = (rawList || []).map((entry) => normalizeModificationEntry(entry, parent)).filter(Boolean);
  for (const mod of modifications) {
    if (!mod.parent) mod.parent = parent;
    // LLM output may reference raw element ids (e.g. "11_285136") instead of
    // registry anchor names; resolve them the same way patch anchors are.
    mod.target = normalizeAnchorValue(mod.target, idToAnchor);
    mod.parent = normalizeAnchorValue(mod.parent, idToAnchor);
  }
  if (!modifications.length) modifications = diffUpdateModifications(patch, previousSpec);
  if (!modifications.length) {
    modifications = [makeModification("self", null, parent,
      "未检测到与上一状态的字段差异；保持原实现不变，仅确认该组件在当前状态可见")].filter(Boolean);
  }
  annotateModificationTypes(modifications, previousSpec);
  // A `delete` may only remove a CHILD component of this container — never the
  // top-level container itself. Drop any delete that targets a container field
  // (self/text/props/...) or resolves to the patch id; such a request would
  // delete the parent, which is not allowed.
  modifications = modifications.filter((mod) => {
    if (!mod || mod.type !== "delete") return true;
    if (!isChildModification(mod)) return false;
    const childId = modificationChildTarget(mod.target);
    return Boolean(childId) && childId !== parent;
  });
  patch.modifications = modifications;

  let rawPreserve = null;
  for (const key of PRESERVE_KEY_ALIASES) {
    if (Array.isArray(patch[key])) {
      rawPreserve = patch[key];
      if (key !== "preserve") delete patch[key];
      break;
    }
  }
  const authored = (rawPreserve || [])
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => normalizeAnchorValue(item, idToAnchor));
  patch.preserve = [...new Set([...authored, ...derivePreserve(patch, previousSpec, modifications)])];
  // Final: fold parent into a single canonical target path and drop parent.
  for (const mod of modifications) canonicalizeModificationTarget(mod, parent);
}

// --- Card-level update bookkeeping -------------------------------------------
// Contract: an update is ledgered at the card/container level. `update.id` is
// the semantic unit being versioned; leaf anchors only appear as modification
// targets. After a card is updated once, its id refers to the NEWEST
// implementation; later states keep/update that id directly and never need to
// replay earlier operations.

function registryTreeInfo(registry) {
  const parentOf = new Map(); // leaf anchor -> parent anchor
  const nodes = registry?.semantic_dom_tree?.nodes;
  if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) {
    for (const [name, node] of Object.entries(nodes)) {
      const children = Array.isArray(node?.children) ? node.children : [];
      if (!children.length && typeof node?.parent === "string" && node.parent) {
        parentOf.set(name, node.parent);
      }
    }
    return { parentOf };
  }
  const roots = registry?.semantic_registry_tree?.roots;
  if (Array.isArray(roots)) {
    const walk = (node, parent) => {
      if (!node || typeof node !== "object") return;
      const anchor = node.anchor || node.name;
      const children = Array.isArray(node.children) ? node.children : [];
      if (anchor && parent && !children.length) parentOf.set(anchor, parent);
      for (const child of children) walk(child, anchor || parent);
    };
    for (const root of roots) walk(root, null);
  }
  return { parentOf };
}

// An update whose id is a LEAF original anchor (e.g. "李华-文本") is folded
// into an update on its parent semantic unit: the leaf becomes a modification
// entry carrying machine-applicable set_text/set_text_style, and the card id
// becomes the ledger key. Multiple leaf updates under the same parent merge
// into one card update.
function mergeLeafOriginalUpdates(updateList, registry, idToAnchor, treeInfo) {
  if (!Array.isArray(updateList) || !updateList.length) return updateList;
  const out = [];
  const hostById = new Map();
  for (const patch of updateList) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;
    const anchor = normalizeAnchorValue(String(patch.id || patch.name || ""), idToAnchor);
    const parentAnchor = treeInfo.parentOf.get(anchor);
    const leafEntry = parentAnchor ? registry.semantic_dom_registry?.[anchor] : null;
    if (!leafEntry) {
      out.push(patch);
      if (anchor) hostById.set(anchor, patch);
      continue;
    }
    const newText = typeof patch.text === "string" && patch.text.trim() ? patch.text : null;
    const mod = makeModification(
      anchor,
      leafEntry.component || null,
      parentAnchor,
      newText
        ? `文本从${shortValueText(leafEntry.text)}改为${shortValueText(newText)}`
        : `按 patch 更新该子元素`
    );
    if (mod) {
      if (newText) mod.set_text = newText;
      if (patch.text_style && typeof patch.text_style === "object") mod.set_text_style = patch.text_style;
    }
    let host = hostById.get(parentAnchor);
    if (!host) {
      const parentEntry = registry.semantic_dom_registry?.[parentAnchor] || {};
      host = {
        type: "update",
        id: parentAnchor,
        component: parentEntry.component || null,
        props: {},
        modifications: [],
        preserve: [],
      };
      out.push(host);
      hostById.set(parentAnchor, host);
    }
    if (!Array.isArray(host.modifications)) host.modifications = [];
    if (mod) host.modifications.push(mod);
    // Carry over any modifications the leaf patch itself authored.
    for (const key of MODIFICATION_KEY_ALIASES) {
      if (!Array.isArray(patch[key])) continue;
      for (const entry of patch[key]) {
        const sub = normalizeModificationEntry(entry, anchor);
        if (sub) host.modifications.push(sub);
      }
    }
  }
  return out;
}

// Cumulative modification ledger per card: each state's update patch carries
// `modifications` = all modifications since the original implementation
// (later entries on the same target win). This makes every state
// self-contained — the renderer applies one list, never an ancestor chain.
// Field-level merge of two modifications that share the same target|parent.
// Scalars (set_text/set_bbox/change/type/...) follow "later wins", but object
// fields (set_props/set_text_style) are DEEP-merged so an earlier state's
// set_props.color is not wiped out when a later state only sets set_bbox or
// set_props.fontSize. Overwriting the whole entry (the old behaviour) silently
// dropped those earlier props from the cumulative ledger.
function mergeOneModification(prev, next) {
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(prev)) return next;
  if (!isObj(next)) return prev;
  const out = { ...prev, ...next };
  if (isObj(prev.set_props) || isObj(next.set_props)) {
    out.set_props = { ...(isObj(prev.set_props) ? prev.set_props : {}), ...(isObj(next.set_props) ? next.set_props : {}) };
  }
  if (isObj(prev.set_text_style) || isObj(next.set_text_style)) {
    out.set_text_style = { ...(isObj(prev.set_text_style) ? prev.set_text_style : {}), ...(isObj(next.set_text_style) ? next.set_text_style : {}) };
  }
  return out;
}

function mergeModificationLists(previous, current) {
  const merged = [];
  const indexByKey = new Map();
  for (const list of [previous, current]) {
    for (const mod of list || []) {
      if (!mod || typeof mod !== "object") continue;
      const key = `${mod.target || ""}`;
      if (indexByKey.has(key)) {
        const idx = indexByKey.get(key);
        merged[idx] = mergeOneModification(merged[idx], mod);
      } else {
        indexByKey.set(key, merged.length);
        merged.push(mod);
      }
    }
  }
  return merged;
}

// Two modifications have the same EFFECT when they touch the same target with
// identical concrete set-fields and type. Cosmetic fields (`change`,
// `target_component`, `parent`) are ignored. Used to detect a later state that
// merely restates an ancestor's change verbatim.
function sameModificationEffect(a, b) {
  if (!a || !b) return false;
  if (String(a.type || "") !== String(b.type || "")) return false;
  const norm = (m) => ({
    set_props: m.set_props && typeof m.set_props === "object" && !Array.isArray(m.set_props) ? m.set_props : null,
    set_text: typeof m.set_text === "string" ? m.set_text : null,
    set_text_style: m.set_text_style && typeof m.set_text_style === "object" ? m.set_text_style : null,
    set_bbox: Array.isArray(m.set_bbox) ? m.set_bbox : null,
  });
  const na = norm(a);
  const nb = norm(b);
  return sameJson(na.set_props, nb.set_props)
    && na.set_text === nb.set_text
    && sameJson(na.set_text_style, nb.set_text_style)
    && sameJson(na.set_bbox, nb.set_bbox);
}

// Keep only the modifications that introduce a NEW effect relative to the
// parent state's cumulative ledger. Virtual (codegen) components are carried
// forward by component-codegen across states, so a later state only needs its
// own delta; entries that merely repeat an ancestor change (same target + same
// set-fields) are dropped to avoid redundant child re-generation.
function dropRestatedModifications(current, baseMods) {
  const baseByTarget = new Map();
  for (const mod of baseMods || []) {
    if (mod && typeof mod === "object") baseByTarget.set(String(mod.target || ""), mod);
  }
  return (current || []).filter((mod) => {
    if (!mod || typeof mod !== "object") return false;
    const prev = baseByTarget.get(String(mod.target || ""));
    if (!prev) return true;
    return !sameModificationEffect(prev, mod);
  });
}

function isOverlayLike(patch) {
  return /overlay|mask|scrim|遮罩/i.test(`${patch?.component || ""} ${patch?.id || ""}`);
}

function isToastLike(patch) {
  return /toast|snackbar|轻提示|提示条/i.test(`${patch?.component || ""} ${patch?.id || ""}`);
}

function isModalSurfaceLike(patch) {
  return /bottomsheet|drawer|modal|dialog|sheet|popup|popover|弹窗|抽屉/i.test(`${patch?.component || ""} ${patch?.id || ""}`);
}

function isStackingExempt(patch) {
  return isOverlayLike(patch) || isModalSurfaceLike(patch) || isToastLike(patch) || /hero|carousel|transparent/i.test(`${patch?.component || ""} ${patch?.id || ""}`);
}

function validBbox(patch) {
  const bbox = Array.isArray(patch?.bbox) ? patch.bbox.map(Number) : [];
  return bbox.length === 4 && bbox.every(Number.isFinite) && bbox[2] > 0 && bbox[3] > 0;
}

// A placement bbox needs only a finite x/y and a positive width; the height
// slot may be 0 (content-driven). Used for heightMode:auto overlay containers.
function hasPlacementBbox(patch) {
  const bbox = Array.isArray(patch?.bbox) ? patch.bbox.map(Number) : [];
  return bbox.length === 4 && bbox.every(Number.isFinite) && bbox[2] > 0 && bbox[3] >= 0;
}

function bboxOf(patch) {
  return validBbox(patch) ? patch.bbox.map(Number) : null;
}

function bboxOverlap(a, b) {
  if (!a || !b) return false;
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

// True when `outer` fully contains `inner` (with a small tolerance). Used to
// exempt nested controls — e.g. a save/back TextButton sitting inside the top
// nav bar — from the same-z "region overlap" rule, which is meant to catch
// peer-level regions (status bar / nav / body / bottom bar) fighting for space,
// not a button legitimately nested within a bar.
function bboxContains(outer, inner, tol = 1) {
  if (!outer || !inner) return false;
  return outer[0] <= inner[0] + tol
    && outer[1] <= inner[1] + tol
    && outer[0] + outer[2] >= inner[0] + inner[2] - tol
    && outer[1] + outer[3] >= inner[1] + inner[3] - tol;
}

function bboxNested(a, b) {
  return bboxContains(a, b) || bboxContains(b, a);
}

function patchZIndex(patch) {
  const z = Number(patch?.props?.zIndex ?? patch?.zIndex ?? patch?.style?.zIndex ?? 0);
  return Number.isFinite(z) ? z : 0;
}

function hasWeakLayoutHints(patch) {
  const layout = patch?.layout;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return false;
  return Boolean(layout.heightMode || layout.flow || layout.group || layout.order != null || layout.widthHint || layout.startAnchor);
}

function collectContentSignals(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectContentSignals(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (/^(id|type|component|className|fontSize|lineHeight|fontWeight|color|zIndex|width|height|x|y|order|flow|group|heightMode|widthHint|startAnchor|endBeforeAnchor|spacingHint)$/i.test(key)) continue;
      collectContentSignals(item, out);
    }
  }
  return out;
}

function richContentStats(patch) {
  const signals = collectContentSignals({
    text: patch.text,
    visible_text: patch.visible_text,
    props: patch.props,
    children: patch.children,
  });
  const unique = [...new Set(signals.filter((text) => !/^(true|false|null|undefined)$/i.test(text)))];
  const meaningful = unique.filter((text) => !/示例|内容\.\.\.|待补充|占位|placeholder|lorem/i.test(text));
  return {
    uniqueCount: unique.length,
    meaningfulCount: meaningful.length,
    totalLength: meaningful.join("").length,
    childCount: patchChildren(patch).length,
  };
}

function inferRequirementName(value, fallback) {
  return String(value || fallback || "")
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function normalizeRichContentRequirements(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  if (String(patch.content_density || "").toLowerCase() === "rich") {
    const requirements = Array.isArray(patch.content_requirements)
      ? patch.content_requirements.filter((item) => typeof item === "string" && item.trim())
      : [];
    const inferred = [];
    for (const key of Object.keys(patch.props || {})) {
      if (/^(variant|className|zIndex|width|height)$/i.test(key)) continue;
      inferred.push(inferRequirementName(key));
    }
    for (const child of patchChildren(patch)) {
      inferred.push(inferRequirementName(child.id || child.name || child.component));
    }
    const next = [...new Set([...requirements, ...inferred].filter(Boolean))];
    while (next.length < 3 && patchChildren(patch).length) {
      next.push(`childContent${next.length + 1}`);
    }
    patch.content_requirements = next;
  }
  for (const child of patchChildren(patch)) normalizeRichContentRequirements(child);
}

function inferSectionTitle(patch) {
  const text = `${patch?.id || ""} ${patch?.name || ""} ${patch?.description || ""}`.toLowerCase();
  if (/doc|document|文档/.test(text) && /detail|content|详情|内容/.test(text)) return "文档详情";
  if (/doc|document|文档/.test(text)) return "文档列表";
  if (/risk|风险/.test(text)) return "风险提示";
  if (/product|产品/.test(text)) return "产品信息";
  if (/service|售后|服务/.test(text)) return "服务信息";
  if (/comment|qa|问答|评论/.test(text)) return "评论/问答";
  if (/tool|工具/.test(text)) return "工具";
  if (/overview|概览/.test(text)) return "概览";
  const firstTextChild = patchChildren(patch).find((child) => typeof child?.text === "string" && child.text.trim());
  if (firstTextChild) return firstTextChild.text.trim().slice(0, 20);
  return "内容";
}

function normalizeComponentProps(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  if (String(patch.component || "").toLowerCase() === "sectionlayout") {
    patch.props = patch.props && typeof patch.props === "object" && !Array.isArray(patch.props) ? patch.props : {};
    if (!patch.props.variant) patch.props.variant = "card";
    if (!patch.props.title) patch.props.title = inferSectionTitle(patch);
  }
  const schema = componentSchema(patch.component);
  if (schema && patch.props && typeof patch.props === "object" && !Array.isArray(patch.props)) {
    // META_PROPS (layoutRole, zIndex, heightMode, ...) are protocol-level and
    // valid on any component, so they must survive schema pruning.
    const allowed = new Set([...schema.required, ...schema.optional, ...META_PROPS]);
    for (const key of Object.keys(patch.props)) {
      if (!allowed.has(key)) delete patch.props[key];
    }
  }
  for (const child of patchChildren(patch)) normalizeComponentProps(child);
}

function componentSchema(name) {
  const key = String(name || "").toLowerCase();
  const schemas = {
    sectionlayout: { required: ["variant"], optional: ["title", "moreText", "onMore", "tabs", "activeTab", "onTabChange", "headerRightAction"] },
    topnav: { required: [], optional: ["variant", "onBack", "activeTab", "tabs", "onTabChange", "title", "drawerValue", "drawerOptions", "onDrawerChange", "drawerDefaultOpen", "actions", "cartCount", "onSearch", "onCart", "onProfile", "onScan", "onMessage", "onSettings", "onGrid", "transparent", "zIndex"] },
    capsulebutton: { required: [], optional: ["children", "size", "variant", "disabled", "icon", "className", "onClick", "loading", "block", "zIndex"] },
    textbutton: { required: [], optional: ["children", "size", "variant", "disabled", "icon", "className", "onClick", "zIndex"] },
    buttonbar: { required: ["variant"], optional: ["primaryLabel", "secondaryLabel", "thirdLabel", "inputPlaceholder", "checkboxLabel", "width", "className", "disabled", "loading", "onPrimaryClick", "onSecondaryClick", "onThirdClick", "zIndex"] },
    inputdemo: { required: [], optional: ["label", "placeholder", "errorMessage", "value", "onChange", "validate", "disabled", "showToggle", "className", "zIndex"] },
    statuspill: { required: ["text"], optional: ["colorMap", "zIndex"] },
    filterpills: { required: ["filters", "activeId"], optional: ["onChange", "fadeEdges", "zIndex"] },
    leftsidebar: { required: ["filters", "activeId"], optional: ["onChange", "zIndex"] },
    productlayout: { required: ["filters", "activeFilter", "subFilters", "activeSubFilter", "products"], optional: ["onFilterChange", "onSubFilterChange", "onProductClick", "onAddToCart", "zIndex"] },
    productcard: { required: ["product"], optional: ["onClick", "onAddToCart", "zIndex"] },
    productselectionlistitem: { required: ["item"], optional: ["onForward", "onMore", "onStatusChange", "isLast", "zIndex"] },
    courselistitem: { required: ["course"], optional: ["onClick", "renderMeta", "zIndex"] },
    hotvideocard: { required: ["title", "imageGradient"], optional: ["subtitle", "imageHeight", "width", "tag", "action", "onShare", "onClick", "zIndex"] },
    icongrid: { required: ["cols", "items"], optional: ["title", "variant", "emptyText", "zIndex"] },
    quickentrygrid: { required: ["items"], optional: ["title", "zIndex"] },
    entrycard: { required: ["card"], optional: ["width", "height", "zIndex"] },
    morebutton: { required: [], optional: ["onClick", "text", "zIndex"] },
    categorytabs: { required: ["categories", "activeId"], optional: ["onChange", "zIndex"] },
    underlinetabs: { required: ["tabs", "activeId"], optional: ["onChange", "size", "className", "zIndex"] },
    statusbar: { required: [], optional: ["zIndex"] },
    bottomnav: { required: [], optional: ["zIndex"] },
  };
  return schemas[key] || null;
}

// Protocol-level metadata props. These are injected by the runner
// (normalizeFixedViewportPatch) or mandated by the page-layer contract / SKILL,
// and are valid on any component regardless of its documented business props.
const META_PROPS = ["layoutRole", "zIndex", "textStyles", "heightMode", "minHeight", "maxHeight"];

// Centered overlay containers float in the middle of the screen and grow with
// their own content; unlike viewport-edge surfaces (BottomSheet/keyboard/bottom
// bar/top nav/mask) they must not freeze an arbitrary fixed bbox height that can
// clip their header/body/footer.
function isCenteredOverlayContainer(patch) {
  const value = `${patch?.component || ""} ${patch?.id || patch?.name || ""}`.toLowerCase();
  if (/bottomsheet|bottom_sheet|bottom-sheet|drawer/.test(value)) return false;
  return /dialog|modal|popover|popup/.test(value);
}

function containerHeightModeAuto(patch) {
  const mode = String(patch?.props?.heightMode ?? patch?.layout?.heightMode ?? "").toLowerCase();
  return mode === "auto" || mode === "content";
}

// Record every nested child id together with the id of the container that
// directly owns it. Used to forbid promoting a container child into a top-level
// update patch (see validateModel), which would detach it from its parent.
function recordContainerChildren(patch, map) {
  const ownerId = patch?.id || patch?.name || null;
  for (const child of patchChildren(patch)) {
    const childId = child?.id || child?.name;
    if (childId && ownerId && !map.has(childId)) map.set(childId, ownerId);
    recordContainerChildren(child, map);
  }
}

function validateComponentProps(patch, stateId, issues) {
  const schema = componentSchema(patch?.component);
  if (!schema) return;
  const props = patch.props || {};
  const allowed = new Set([...schema.required, ...schema.optional, ...META_PROPS]);
  for (const key of Object.keys(props)) {
    if (!allowed.has(key)) {
      issues.push(`${stateId}.${patch.id || patch.name || patch.component} unknown prop "${key}" for ${patch.component}`);
    }
  }
  for (const key of schema.required) {
    const satisfiedByTopLevelText = key === "text" && typeof patch.text === "string" && patch.text.trim();
    if (props[key] == null && !satisfiedByTopLevelText) {
      issues.push(`${stateId}.${patch.id || patch.name || patch.component} missing required prop "${key}" for ${patch.component}`);
    }
  }
}

function hasStructuredContainerContent(patch) {
  return patchChildren(patch).length > 0;
}

// A top-level flow card may anchor itself via layout.startAnchor ("below:xxx")
// but omit layout.group. page-layer groups flow cards by layout.group and
// applies the startAnchor offset per group; a card with a startAnchor but no
// group is dropped from flow layout entirely and renders at the container top,
// overlapping any absolutely-placed anchor it was meant to sit below (e.g. a
// created/kept top nav). Synthesize a singleton group keyed by the card id so
// the flow placement (and its startAnchor offset) applies.
function ensureFlowGroupForAnchoredPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  if (Array.isArray(patch.bbox)) return; // bbox-placed cards are absolute, not flow
  const layout = patch.layout;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return;
  if (!layout.startAnchor || layout.group) return;
  const id = patch.id || patch.name;
  if (!id) return;
  layout.group = String(id);
  if (layout.order == null) layout.order = 1;
}

function normalizeNestedChildLayout(patch, depth = 0) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return;
  if (depth > 0 && Array.isArray(patch.bbox)) {
    const bbox = patch.bbox.map(Number);
    patch.props = patch.props && typeof patch.props === "object" && !Array.isArray(patch.props) ? patch.props : {};
    if (patch.props.width == null && Number.isFinite(bbox[2])) patch.props.width = bbox[2];
    if (patch.props.height == null && Number.isFinite(bbox[3])) patch.props.height = bbox[3];
    delete patch.bbox;
  }
  for (const child of patchChildren(patch)) normalizeNestedChildLayout(child, depth + 1);
}

function validatePatchShape(patch, stateId, issues, depth = 0) {
  if (!patch || typeof patch !== "object") return;
  if (patch.type === "bind" || patch.type === "keep") return;
  validateComponentProps(patch, stateId, issues);
  const isUpdatePatch = patch.type === "update";
  if (depth === 0 && !isUpdatePatch) {
    // A bottom-action candidate (e.g. ButtonBar) only counts as a viewport-fixed
    // surface when it actually signals bottom intent; otherwise it is an inline
    // action row and may be placed by bbox OR weak layout like any card.
    const inlineActionBar = isBottomActionPatch(patch) && !namedViewportBottomBar(patch);
    const fixedPlacement = isFixedPlacementComponent(patch) && !inlineActionBar;
    // A centered overlay container in heightMode:auto only needs a placement
    // bbox (x/y/width); its height is content-driven, so a 0 or omitted height
    // slot is acceptable as long as x/y/width are present.
    const autoOverlayPlaced = isCenteredOverlayContainer(patch) && containerHeightModeAuto(patch) && hasPlacementBbox(patch);
    if (fixedPlacement && !validBbox(patch) && !autoOverlayPlaced) {
      issues.push(`${stateId}.${patch.id || patch.name || patch.component} fixed component requires valid bbox`);
    }
    if (!fixedPlacement && !validBbox(patch) && !hasWeakLayoutHints(patch)) {
      issues.push(`${stateId}.${patch.id || patch.name || patch.component} ordinary top-level component requires bbox or weak layout hints`);
    }
  }
  if (String(patch.content_density || "").toLowerCase() === "rich") {
    const requirements = Array.isArray(patch.content_requirements) ? patch.content_requirements : [];
    const stats = richContentStats(patch);
    if (requirements.length < 3) {
      issues.push(`${stateId}.${patch.id || patch.name || patch.component} rich card requires at least 3 content_requirements`);
    }
    if (stats.meaningfulCount < 4 || stats.totalLength < 32) {
      issues.push(`${stateId}.${patch.id || patch.name || patch.component} rich card lacks enough concrete business content in state model`);
    }
  }
  if (String(patch.component || "").toLowerCase() === "sectionlayout" && patchChildren(patch).length === 0) {
    issues.push(`${stateId}.${patch.id || patch.name || "SectionLayout"} SectionLayout requires non-empty children`);
  }
  // A centered overlay container that carries children must let its content
  // drive the height (props.heightMode:"auto"); a guessed fixed bbox height
  // clips its own header/body/footer. Viewport-edge surfaces are exempt.
  if (depth === 0 && isCenteredOverlayContainer(patch) && patchChildren(patch).length > 0
    && !containerHeightModeAuto(patch)) {
    issues.push(`${stateId}.${patch.id || patch.name || patch.component} centered overlay container with children must set props.heightMode:"auto" (content-driven height) instead of a guessed fixed bbox height, or its header/body/footer will be clipped`);
  }
  // Update patches use top-level text as the rewrite channel (the rest of the
  // component is preserved), so the container-text rule only applies to creates.
  // A short single label (e.g. a dashed "添加项目" CTA card) is legitimate; the
  // rule targets rich content collapsed into one text blob.
  const containerText = typeof patch.text === "string" ? patch.text.trim() : "";
  if (patch.type !== "update" && isContainerLike(patch) && containerText
    && (containerText.length > 24 || /\n/.test(containerText))
    && !hasStructuredContainerContent(patch)) {
    issues.push(`${stateId}.${patch.id || patch.name || "component"} container must not use top-level text without children`);
  }
  for (const child of patchChildren(patch)) validatePatchShape(child, stateId, issues, depth + 1);
}

function stateContentBottom(state) {
  let bottom = 0;
  for (const patch of state.inheritance?.create || []) bottom = Math.max(bottom, patchBottom(patch));
  for (const patch of state.inheritance?.update || []) bottom = Math.max(bottom, patchBottom(patch));
  return bottom;
}

function validateStateStacking(state, registry, virtualPatches, issues) {
  const fixed = [];
  function addFixed(patch, source) {
    if (!patch || !validBbox(patch)) return;
    fixed.push({ patch, source, id: patch.id || patch.name || patch.component || source, bbox: bboxOf(patch), z: patchZIndex(patch) });
  }

  for (const anchor of state.inheritance?.keep || []) {
    if (typeof anchor !== "string") continue;
    const virtual = virtualPatches.get(anchor);
    if (virtual) {
      addFixed(virtual, "keep");
      continue;
    }
    const entry = registry.semantic_dom_registry?.[anchor];
    if (entry?.bbox) {
      addFixed({ id: anchor, component: entry.component || entry.semantic || "kept_anchor", bbox: entry.bbox, props: { zIndex: 0 } }, "original_keep");
    }
  }
  for (const patch of state.inheritance?.create || []) addFixed(patch, "create");
  for (const patch of state.inheritance?.update || []) addFixed(patch, "update");

  // An entity placed exactly at its registry bbox reproduces original page
  // geometry (kept region, or an in-place card update); two such entities
  // overlapping is the original layout's own business, not a model error.
  function isOriginalGeometry(item) {
    if (item.source === "original_keep") return true;
    const entry = item.id ? registry.semantic_dom_registry?.[item.id] : null;
    return Array.isArray(entry?.bbox) && sameJson(entry.bbox.map(Number), item.bbox);
  }

  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i];
      const b = fixed[j];
      if (isOriginalGeometry(a) && isOriginalGeometry(b)) continue;
      if (a.z !== b.z) continue;
      if (isStackingExempt(a.patch) || isStackingExempt(b.patch)) continue;
      if (a.id === b.id) continue;
      if (bboxNested(a.bbox, b.bbox)) continue;
      if (bboxOverlap(a.bbox, b.bbox)) {
        issues.push(`${state.id} fixed same-z bbox overlap: ${a.id} and ${b.id} at zIndex ${a.z}`);
      }
    }
  }

  const overlays = fixed.filter((item) => isOverlayLike(item.patch));
  const surfaces = fixed.filter((item) => isModalSurfaceLike(item.patch) && !isOverlayLike(item.patch));
  for (const surface of surfaces) {
    const coveringOverlay = overlays
      .filter((overlay) => overlay.z < surface.z && bboxOverlap(overlay.bbox, surface.bbox))
      .sort((a, b) => b.z - a.z)[0];
    if (!coveringOverlay) {
      issues.push(`${state.id}.${surface.id} modal/sheet surface requires a lower-z global overlay covering it`);
    }
  }

  const inheritedSurfaceMaxZ = Math.max(
    -Infinity,
    ...fixed.filter((item) => item.source === "keep" && isModalSurfaceLike(item.patch) && !isOverlayLike(item.patch)).map((item) => item.z)
  );
  if (Number.isFinite(inheritedSurfaceMaxZ)) {
    const keptSurfaceIds = new Set(
      fixed.filter((item) => item.source === "keep" && isModalSurfaceLike(item.patch) && !isOverlayLike(item.patch)).map((item) => item.id)
    );
    const currentOverlays = overlays.filter((item) => item.source === "create" || item.source === "update");
    // Updating an inherited modal (same id) is not a new stacked layer; only a
    // freshly created surface with a NEW id stacks on top of the inherited one.
    const currentSurfaces = surfaces.filter((item) => item.source === "create" && !keptSurfaceIds.has(item.id));
    if (currentSurfaces.length) {
      const raisedOverlay = currentOverlays.find((overlay) => overlay.z > inheritedSurfaceMaxZ);
      if (!raisedOverlay) {
        issues.push(`${state.id} stacked modal requires a new overlay zIndex greater than inherited modal zIndex ${inheritedSurfaceMaxZ}`);
      }
      for (const surface of currentSurfaces) {
        const overlay = currentOverlays.filter((item) => item.z < surface.z).sort((a, b) => b.z - a.z)[0];
        if (!overlay) issues.push(`${state.id}.${surface.id} stacked modal surface zIndex must be greater than its current overlay`);
      }
    }
  }
}

function normalizeModel(model, initialHeight, registry = {}) {
  delete model.semanticAnchors;
  delete model.semantic_registry;
  const idToAnchor = registryIdToAnchorMap(registry);
  const treeInfo = registryTreeInfo(registry);

  const virtualPatchById = new Map();
  // Ids that were CREATED by the state model (virtual codegen components, plus
  // their nested children). These are rendered from generated React and carried
  // forward by component-codegen, so their update patches only need a per-state
  // delta. Original DOM anchors (registry keys not in this set) instead keep a
  // cumulative ledger because page-layer replays it onto a clone of the source.
  const createdVirtualIds = new Set();
  for (const state of model.states || []) {
    const patchList = Array.isArray(state.patches) ? state.patches : [];
    const inheritance = state.inheritance && typeof state.inheritance === "object" && !Array.isArray(state.inheritance) ? state.inheritance : {};
    const keep = new Set((inheritance.keep || []).map((item) => typeof item === "string" ? normalizeAnchorValue(item, idToAnchor) : item));
    const create = Array.isArray(inheritance.create) ? inheritance.create.slice() : [];
    const update = Array.isArray(inheritance.update) ? inheritance.update.slice() : [];

    // Backward compat: an LLM may still place create/update/keep in `patches`.
    // Fold them into inheritance; `bind` is now expressed via `triggers`.
    for (const patch of patchList) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;
      normalizePatchAnchorRefs(patch, idToAnchor);
      const anchor = patchAnchor(patch);
      if (patch.type === "keep" && anchor) keep.add(anchor);
      if (patch.type === "create") create.push(patch);
      if (patch.type === "update") update.push(patch);
    }

    // Outbound triggers: the LLM emits a `triggers` array (current prompt shape).
    const rawTriggers = Array.isArray(state.triggers) ? state.triggers : [];
    let triggers = dedupeTriggers(rawTriggers.map((trig) => normalizeOutboundTrigger(trig, idToAnchor)));
    // An outbound trigger must point to another state, never the state's own id.
    state.triggers = triggers.filter((trig) => gotoStateNum(trig.goto) !== stateNum(state.id));
    delete state.trigger;

    state.inheritance = { keep: [...keep], create, update: mergeLeafOriginalUpdates(update, registry, idToAnchor, treeInfo) };
    // Patches are no longer part of the model; interaction lives on `triggers`.
    state.patches = [];
    // Reference height for "authored flush at the bottom" detection: the state's
    // own authored canvas height when present, else the initial viewport height.
    const bottomRef = Number(state.height) || Number(initialHeight) || 936;
    for (const patch of state.inheritance.create) {
      normalizePatchAnchorRefs(patch, idToAnchor);
      normalizeNestedChildLayout(patch);
      normalizeComponentProps(patch);
      normalizeRichContentRequirements(patch);
      normalizeRichRequirements(patch);
      normalizeFixedViewportPatch(patch, initialHeight, bottomRef);
      ensureFlowGroupForAnchoredPatch(patch);
      registerPatchTree(patch, virtualPatchById);
      for (const cid of collectPatchIds(patch)) createdVirtualIds.add(cid);
    }
    for (const patch of state.inheritance.update) {
      const previousSpec = previousSpecForUpdate(patch, virtualPatchById, registry, idToAnchor);
      mergeVirtualPlacement(patch, virtualPatchById);
      normalizePatchAnchorRefs(patch, idToAnchor);
      normalizeNestedChildLayout(patch);
      normalizeComponentProps(patch);
      normalizeRichContentRequirements(patch);
      normalizeRichRequirements(patch);
      normalizeFixedViewportPatch(patch, initialHeight, bottomRef);
      normalizeUpdateModifications(patch, previousSpec, idToAnchor);
      normalizeOriginalAnchorUpdatePatch(patch, registry, virtualPatchById);
      ensureOriginalUpdateRenderable(patch, state, registry, virtualPatchById);
      if (patch?.id || patch?.name) {
        const id = patch.id || patch.name;
        const base = virtualPatchById.get(id) || previousSpec || {};
        // Cumulative ledger: every change to this component since its original
        // implementation (later wins, field-level merge). The virtualPatchById
        // entry always tracks this so the NEXT state diffs/preserves correctly.
        const cumulative = mergeModificationLists(base.modifications, patch.modifications);
        const isOriginalAnchor = Boolean(registry?.semantic_dom_registry?.[id]) && !createdVirtualIds.has(id);
        if (isOriginalAnchor) {
          // Original DOM anchors are re-realised by page-layer replaying the
          // cumulative ledger onto a fresh clone of the original pixels, so the
          // emitted patch must carry every change since the original.
          patch.modifications = cumulative;
        } else {
          // Virtual codegen components are carried forward across states by
          // component-codegen (generatedById + lastChildrenById). Emit only this
          // state's real delta; drop entries that merely restate an ancestor
          // change so unchanged children are not needlessly re-generated.
          let delta = dropRestatedModifications(patch.modifications, base.modifications);
          if (!delta.length) {
            delta = [makeModification("self", null, id,
              "本状态未改变该组件，沿用上一状态实现")].filter(Boolean);
          }
          patch.modifications = delta;
        }
        virtualPatchById.set(id, {
          ...base,
          ...patch,
          modifications: cumulative,
          props: { ...(base.props || {}), ...(patch.props || {}) },
        });
      }
    }
    const requestedHeight = Number(state.height);
    const contentHeight = stateContentBottom(state);
    state.height = Math.max(
      Number(initialHeight) || 0,
      Number.isFinite(requestedHeight) ? requestedHeight : 0,
      contentHeight
    );
  }

  // NOTE: ancestor-updated cards are no longer auto-added to keep here. The
  // page-layer runtime (tfEnsureUpdatedKeepSlots) discovers them at render time
  // and mounts a slot when their region is kept, so this build-time pass is gone.
  return model;
}

// Original DOM anchor updates must NOT carry virtual-component fields
// (component/layout/props). Placement is set_bbox/patch.bbox; content changes
// live in modifications (+ optional children). Strip LLM mistakes here.
function isRegistryOriginalAnchor(id, registry, virtualPatchById) {
  return Boolean(id && registry?.semantic_dom_registry?.[id] && !virtualPatchById.has(id));
}

function selfSetBboxFromPatch(patch) {
  const selfId = patch?.id || patch?.name;
  for (const mod of (patch?.modifications || [])) {
    if (!mod || !Array.isArray(mod.set_bbox) || mod.set_bbox.length !== 4) continue;
    const t = String(mod.target || "");
    if (!t || t === "self" || t === "bbox" || t === selfId || t === "children." + selfId) {
      const bbox = mod.set_bbox.map(Number);
      if (bbox.length === 4 && bbox.every(Number.isFinite)) return bbox;
    }
  }
  return null;
}

function normalizeOriginalAnchorUpdatePatch(patch, registry, virtualPatchById) {
  const id = patch?.id || patch?.name;
  if (!isRegistryOriginalAnchor(id, registry, virtualPatchById)) return;
  delete patch.component;
  delete patch.layout;
  delete patch.content_density;
  delete patch.content_requirements;
  delete patch.props;
  const selfBbox = selfSetBboxFromPatch(patch);
  if (selfBbox) patch.bbox = selfBbox;
}

// Original-anchor updates come in two patterns:
//   A. Content rewrite — a text/props-only patch applied inside the keep clone
//      of the region containing the anchor (e.g. swapping 李华 → 张三). Needs a
//      kept host region or the rewrite is invisible.
//   B. Re-render/reposition — the patch carries its own component + bbox (or
//      layout/children) and is mounted standalone at the new position (e.g. a
//      card moving up after a removal). The region is intentionally NOT kept.
// Only pattern A requires keep coverage.
function isSelfRenderableUpdatePatch(patch) {
  if (validBbox(patch)) return true;
  if (patchChildren(patch).length) return true;
  if (selfSetBboxFromPatch(patch)) return true;
  if (patch?.layout?.group) return true;
  return false;
}

// Deterministic repair for pattern A updates whose host region is not kept:
// inject the anchor's registry bbox so the patch becomes self-renderable and
// page-layer mounts it standalone at the original position (mode C) instead of
// the rewrite silently disappearing or validation forcing an LLM retry.
function ensureOriginalUpdateRenderable(patch, state, registry, virtualPatchById) {
  const anchor = patchAnchor(patch);
  if (!anchor || virtualPatchById.has(anchor)) return;
  const entry = registry.semantic_dom_registry?.[anchor];
  const bbox = Array.isArray(entry?.bbox) ? entry.bbox.map(Number) : null;
  if (!bbox || bbox.length < 4 || !bbox.every(Number.isFinite)) return;
  if (isSelfRenderableUpdatePatch(patch)) return;
  if (keptAnchorContainsUpdateTarget(state, registry, anchor)) return;
  patch.bbox = bbox;
}

// An update on an original DOM anchor is applied by rewriting the keep clone
// of the region that contains it. If the state keeps neither the anchor itself
// nor any region whose bbox contains it, the rewrite has no visible host.
function keptAnchorContainsUpdateTarget(state, registry, anchor) {
  const target = registry.semantic_dom_registry?.[anchor];
  const targetBbox = Array.isArray(target?.bbox) ? target.bbox.map(Number) : null;
  if (!targetBbox) return true;
  for (const kept of state.inheritance?.keep || []) {
    if (typeof kept !== "string") continue;
    if (kept === anchor) return true;
    const entry = registry.semantic_dom_registry?.[kept];
    const keptBbox = Array.isArray(entry?.bbox) ? entry.bbox.map(Number) : null;
    if (keptBbox && bboxContains(keptBbox, targetBbox)) return true;
  }
  return false;
}

function validateModel(model, registry) {
  const issues = [];
  const originalAnchors = new Set(Object.keys(registry.semanticAnchors || {}));
  const virtualAnchors = new Set();
  const virtualPatches = new Map();
  // Ids ever created as a TOP-LEVEL create patch, and the container parent of
  // ids only ever created as a nested child. Used to forbid promoting a
  // container child into a top-level update patch.
  const topLevelCreatedIds = new Set();
  const containerChildParent = new Map();

  if (!Array.isArray(model.states)) issues.push("missing states[]");
  const sorted = [...(model.states || [])].sort((a, b) => stateNum(a.id) - stateNum(b.id));
  const allStateNums = new Set(sorted.map((state) => stateNum(state.id)));

  for (const state of sorted) {
    if (!state.id) issues.push("state missing id");
    if (!Number.isFinite(Number(state.height)) || Number(state.height) <= 0) issues.push(`${state.id} missing numeric height`);
    const contentBottom = stateContentBottom(state);
    if (Number(state.height || 0) < contentBottom) issues.push(`${state.id} height ${state.height} smaller than content bottom ${contentBottom}`);
    if (stateNum(state.id) > 1 && !state.parent_state) issues.push(`${state.id} missing parent_state`);
    if (stateNum(state.id) === 1 && !state.parent_state
      && ((state.inheritance?.create || []).length || (state.inheritance?.update || []).length)) {
      // state_1 is the original captured page rendered from app-root; page-layer
      // does not render its create/update components, so any bind to them is
      // dead. First-screen interactions must target original DOM anchors.
      issues.push(`${state.id} is the original captured page and must not create/update components; bind first-screen interactions to original DOM anchors instead`);
    }

    // Validate outbound triggers (new model).
    for (const trig of state.triggers || []) {
      const gotoNum = gotoStateNum(trig?.goto);
      if (!gotoNum || !allStateNums.has(gotoNum)) {
        issues.push(`${state.id} trigger goto "${trig?.goto}" does not match any known state id`);
      }
      if (gotoNum === stateNum(state.id)) {
        issues.push(`${state.id} trigger goto must point to a different state, not itself`);
      }
      if (trig?.action === "click" && !trig.anchor) {
        issues.push(`${state.id} click trigger is missing an anchor`);
      }
      if (trig?.action === "click" && trig.anchor) {
        // Anchor check deferred to after virtual ids are registered.
      }
    }
    // state_1 click triggers must bind original DOM anchors only.
    if (stateNum(state.id) === 1) {
      for (const trig of state.triggers || []) {
        if (trig?.action === "click" && trig.anchor && !originalAnchors.has(trig.anchor)) {
          issues.push(`${state.id} trigger anchor "${trig.anchor}" must be an original DOM anchor on state_1`);
        }
      }
    }

    if (state.inheritance?.hide) issues.push(`${state.id} must not output inheritance.hide`);
    if (state.inheritance?.replace) issues.push(`${state.id} must not output inheritance.replace`);
    for (const patch of state.inheritance?.create || []) validatePatchShape(patch, state.id, issues);
    for (const patch of state.inheritance?.update || []) validatePatchShape(patch, state.id, issues);
    validateStateStacking(state, registry, virtualPatches, issues);

    const refs = [];
    for (const item of state.inheritance?.keep || []) {
      const anchor = typeof item === "string" ? item : patchAnchor(item);
      if (anchor) refs.push(anchor);
    }
    for (const patch of state.inheritance?.update || []) {
      const anchor = patchAnchor(patch);
      if (anchor) refs.push(anchor);
      const patchLabel = patch?.id || patch?.name || "update";
      const updateId = patch?.id || patch?.name;
      if (updateId && containerChildParent.has(updateId) && !topLevelCreatedIds.has(updateId)) {
        const owner = containerChildParent.get(updateId);
        issues.push(`${state.id}.${patchLabel} update target "${updateId}" was created as a child of container "${owner}"; an update target must be a top-level container. Update the owning container "${owner}" instead and express this change inside its modifications/children, so the child stays inside the container rather than being promoted to a page-level fixed component`);
      }
      const modifications = Array.isArray(patch?.modifications) ? patch.modifications : [];
      if (!modifications.length) {
        issues.push(`${state.id}.${patchLabel} update patch requires a non-empty modifications list`);
      }
      for (const mod of modifications) {
        if (!mod || typeof mod !== "object" || !String(mod.target || "").trim() || !String(mod.change || "").trim()) {
          issues.push(`${state.id}.${patchLabel} update modification entries require target and change`);
        }
      }
      if (!Array.isArray(patch?.preserve)) {
        issues.push(`${state.id}.${patchLabel} update patch requires a preserve array`);
      }
      if (anchor && originalAnchors.has(anchor) && !virtualAnchors.has(anchor)) {
        if (patch.component || patch.layout) {
          issues.push(`${state.id}.${patchLabel} original DOM anchor "${anchor}" must not carry component/layout; express placement via set_bbox/patch.bbox and content via modifications (optional children)`);
        }
      }
      if (anchor && originalAnchors.has(anchor) && !virtualAnchors.has(anchor)
        && !isSelfRenderableUpdatePatch(patch)
        && !keptAnchorContainsUpdateTarget(state, registry, anchor)) {
        issues.push(`${state.id}.${patchLabel} content-only update on original anchor "${anchor}" needs the state to keep it or a containing region (or carry its own bbox/layout to re-render standalone); otherwise the rewrite is invisible`);
      }
    }
    for (const anchor of refs) {
      if (typeof anchor !== "string" || (!originalAnchors.has(anchor) && !virtualAnchors.has(anchor))) {
        issues.push(`${state.id} references unknown anchor: ${anchor}`);
      }
    }
    for (const patch of state.inheritance?.create || []) {
      collectPatchIds(patch).forEach((id) => virtualAnchors.add(id));
      registerPatchTree(patch, virtualPatches);
      const topId = patch?.id || patch?.name;
      if (topId) topLevelCreatedIds.add(topId);
      recordContainerChildren(patch, containerChildParent);
    }
    for (const patch of state.inheritance?.update || []) {
      // Children introduced by an update patch are rendered into the DOM with
      // their own component ids, so later states may keep/bind them.
      collectPatchIds(patch).forEach((id) => virtualAnchors.add(id));
      const id = patch?.id || patch?.name;
      if (id && virtualPatches.has(id)) {
        virtualPatches.set(id, { ...virtualPatches.get(id), ...patch, props: { ...(virtualPatches.get(id).props || {}), ...(patch.props || {}) } });
      }
      for (const child of patchChildren(patch)) registerPatchTree(child, virtualPatches);
    }
    // Trigger anchor check: defer until virtual ids for this state are
    // registered above so a newly created component can be a valid anchor.
    for (const trig of state.triggers || []) {
      if (trig?.action === "click" && trig.anchor
        && !originalAnchors.has(trig.anchor) && !virtualAnchors.has(trig.anchor)) {
        issues.push(`${state.id} trigger anchor "${trig.anchor}" is unknown (not in original DOM anchors or previously created virtual components)`);
      }
    }
  }

  return issues;
}

async function callLLM({ model, system, user, maxTokens }) {
  return callJsonChat({ model, system, user, maxTokens, label: "state-implementation-model" });
}

async function main() {
  loadSkillEnv();
  configureNodePath();
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  const base = resolveArgPath(args[0] || ".", cwd);
  const model = resolveTextModel(argValue(args, "--model", ""));
  const width = Number(argValue(args, "--width", "360"));
  const height = Number(argValue(args, "--height", "792"));
  const blueprintPath = resolveArgPath(argValue(args, "--blueprint", latestBlueprint(base)), cwd);
  const registryPath = resolveArgPath(
    argValue(args, "--registry", path.join(base, ".preprocess", "semantic_registry.json")),
    cwd,
  );
  const out = resolveArgPath(
    argValue(args, "--out", path.join(base, ".run_skill", "state_implementation", "state_implementation_model.llm.json")),
    cwd,
  );
  const skillPath = path.resolve(__dirname, "..", "SKILL.md");
  const skill = readUtf8(skillPath);
  const blueprint = JSON.parse(readUtf8(blueprintPath));
  const registry = JSON.parse(readUtf8(registryPath));
  const componentReference = componentLibraryReference();
  const skillInput = {
    viewport: {
      width,
      initial_height: height,
      width_locked: true,
      height_may_expand: true,
    },
    blueprint,
    semantic_registry: semanticRegistryForPrompt(registry),
    layout_constraints: layoutConstraints(),
    component_library_reference: componentReference,
  };

  writeUtf8(out.replace(/\.json$/, ".skill_input.json"), JSON.stringify(skillInput, null, 2));

  const maxTokens = Number(argValue(args, "--max-tokens", "12000"));
  const maxAttempts = Math.max(1, Number(argValue(args, "--max-attempts", "3")));
  let parsed = null;
  let issues = [];
  let best = null; // { parsed, issues } with the fewest issues seen so far
  let correction = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await callLLM({
      model,
      system: skill + "\n\nReturn JSON only.",
      user: JSON.stringify(skillInput) + correction,
      maxTokens,
    });
    writeUtf8(out.replace(/\.json$/, `.raw.attempt${attempt}.txt`), raw);
    writeUtf8(out.replace(/\.json$/, ".raw.txt"), raw);

    parsed = normalizeModel(extractJson(raw), height, registry);
    issues = validateModel(parsed, registry);
    if (!best || issues.length < best.issues.length) best = { parsed, issues };
    if (!issues.length) break;

    console.error(`[state-model-llm] attempt ${attempt}/${maxAttempts} validation issues:\n` + issues.join("\n"));
    correction = "\n\nThe previous output FAILED validation. Regenerate the COMPLETE JSON"
      + " (all states) and fix every one of these issues without introducing new ones:\n- "
      + issues.join("\n- ");
  }

  // Persist the best attempt (fewest issues) so downstream stages get the most
  // valid model even if no attempt was perfectly clean.
  ({ parsed, issues } = best);
  writeUtf8(out, JSON.stringify(parsed, null, 2));
  writeUtf8(out.replace(/\.json$/, ".validation.json"), JSON.stringify({ issues }, null, 2));
  if (issues.length) {
    console.error(`[state-model-llm] validation issues remain after ${maxAttempts} attempt(s):\n` + issues.join("\n"));
    process.exit(2);
  }
  console.log(`[state-model-llm] out=${out}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[state-model-llm] ERROR:", err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { normalizeModel, validateModel };
