#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../../../../../../..");
const SKILL_ROOT = path.resolve(__dirname, "../../../../..");

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

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of readUtf8(file).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] == null) process.env[match[1]] = value;
  }
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
function isSystemBindAnchor(anchor) {
  return typeof anchor === "string" && /^(system|auto|timer|timeout|load(ing|_complete)?|none|null|submit_success|success)$/i.test(anchor.trim());
}

function gotoStateNum(value) {
  const match = String(value || "").match(/state[_-]?(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function patchGotoStateNum(patch) {
  return gotoStateNum(patch?.goto) || gotoStateNum(patch?.action);
}

function isClickAction(action) {
  // Long-press degrades to a click: the static prototype cannot listen for a
  // real long-press, so it is treated as a tap/click trigger.
  return /(^|:)click$/i.test(String(action || "")) || /^tap$/i.test(String(action || ""))
    || /long[\s_-]?press|长按/i.test(String(action || ""));
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
    return copyModificationSetFields(entry, makeModification(
      parsed.target,
      entry.target_component || entry.component || parsed.target_component,
      entry.parent || parsed.parent || parentId,
      change
    ));
  }
  const keys = Object.keys(entry);
  if (keys.length === 1 && typeof entry[keys[0]] === "string") {
    const parsed = parseModificationTarget(keys[0]);
    return makeModification(parsed.target, parsed.target_component, parsed.parent || parentId, entry[keys[0]]);
  }
  return null;
}

function shortValueText(value) {
  if (value == null) return "null";
  const text = typeof value === "string" ? `「${value}」` : JSON.stringify(value);
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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
      mods.push(makeModification(childId, child.component || null, parent, "新增子组件"));
    } else if (!sameJson(prevChildren.get(childId), child)) {
      mods.push(makeModification(childId, child.component || prevChildren.get(childId)?.component || null, parent, "子组件内容/属性更新，按当前 patch 重渲染该子组件"));
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
// modifications_applied = all modifications since the original implementation
// (later entries on the same target win). This makes every state
// self-contained — the renderer applies one list, never an ancestor chain.
function mergeModificationLists(previous, current) {
  const merged = [];
  const indexByKey = new Map();
  for (const list of [previous, current]) {
    for (const mod of list || []) {
      if (!mod || typeof mod !== "object") continue;
      const key = `${mod.target || ""}|${mod.parent || ""}`;
      if (indexByKey.has(key)) merged[indexByKey.get(key)] = mod;
      else {
        indexByKey.set(key, merged.length);
        merged.push(mod);
      }
    }
  }
  return merged;
}

// When a later state keeps a region that contains a card updated earlier in
// its parent chain, the card id is auto-added to keep so the state renders the
// NEWEST card without restating the update.
function autoKeepUpdatedCards(model, registry) {
  const byId = new Map((model.states || []).map((state) => [state.id, state]));
  for (const state of model.states || []) {
    const chain = [];
    const seen = new Set();
    let cursor = state;
    while (cursor && cursor.parent_state && !seen.has(cursor.parent_state)) {
      seen.add(cursor.parent_state);
      cursor = byId.get(cursor.parent_state);
      if (cursor) chain.push(cursor);
    }
    const updatedCards = new Map();
    for (const ancestor of chain.reverse()) {
      for (const patch of ancestor.inheritance?.update || []) {
        const id = patch?.id || patch?.name;
        const entry = id ? registry.semantic_dom_registry?.[id] : null;
        if (entry && Array.isArray(entry.bbox)) updatedCards.set(id, entry.bbox.map(Number));
      }
    }
    if (!updatedCards.size) continue;
    const keep = state.inheritance?.keep;
    if (!Array.isArray(keep)) continue;
    const present = new Set([
      ...keep.filter((item) => typeof item === "string"),
      ...(state.inheritance?.update || []).map((patch) => patch?.id || patch?.name),
      ...(state.inheritance?.create || []).map((patch) => patch?.id || patch?.name),
    ].filter(Boolean));
    for (const [id, bbox] of updatedCards) {
      if (present.has(id)) continue;
      const coveredByKeep = keep.some((item) => {
        if (typeof item !== "string" || item === id) return false;
        const entry = registry.semantic_dom_registry?.[item];
        return Array.isArray(entry?.bbox) && bboxContains(entry.bbox.map(Number), bbox);
      });
      if (coveredByKeep) keep.push(id);
    }
  }
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
  for (const patch of state.patches || []) {
    if (patch?.type === "create" || patch?.type === "update") bottom = Math.max(bottom, patchBottom(patch));
  }
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
  for (const state of model.states || []) {
    if (!state.trigger || typeof state.trigger !== "object" || Array.isArray(state.trigger)) state.trigger = null;
    if (stateNum(state.id) === 1 && !state.parent_state) state.trigger = null;
    if (typeof state.trigger?.anchor === "string") state.trigger.anchor = normalizeAnchorValue(state.trigger.anchor, idToAnchor);

    const patchList = Array.isArray(state.patches) ? state.patches : [];
    const inheritance = state.inheritance && typeof state.inheritance === "object" && !Array.isArray(state.inheritance) ? state.inheritance : {};
    const keep = new Set((inheritance.keep || []).map((item) => typeof item === "string" ? normalizeAnchorValue(item, idToAnchor) : item));
    const create = Array.isArray(inheritance.create) ? inheritance.create.slice() : [];
    const update = Array.isArray(inheritance.update) ? inheritance.update.slice() : [];

    for (const patch of patchList) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;
      normalizePatchAnchorRefs(patch, idToAnchor);
      const anchor = patchAnchor(patch);
      if (patch.type === "keep" && anchor) keep.add(anchor);
      if (patch.type === "create") create.push(patch);
      if (patch.type === "update") update.push(patch);
      if (patch.type === "bind" && anchor && !isSystemBindAnchor(anchor)) {
        const targetNum = patchGotoStateNum(patch);
        if (!patch.goto && targetNum) patch.goto = `state_${targetNum}`;
        if (!state.trigger && stateNum(state.id) > 1 && targetNum === stateNum(state.id)) {
          state.trigger = { event: patch.event || "click", anchor, action: isClickAction(patch.action) ? "click" : (patch.action || "click"), goto: state.id };
        }
      }
    }

    if (state.trigger && /^goto:/i.test(String(state.trigger.action || ""))) {
      state.trigger.action = `goto:${state.id}`;
    }
    if (state.trigger && stateNum(state.id) > 1) {
      const action = String(state.trigger.action || state.trigger.event || "");
      if (isClickAction(action) || /^goto:/i.test(String(state.trigger.action || ""))) {
        state.trigger.goto = state.id;
      }
    }

    state.inheritance = { keep: [...keep], create, update: mergeLeafOriginalUpdates(update, registry, idToAnchor, treeInfo) };
    state.patches = patchList.filter((patch) => patch?.type !== "hide" && patch?.type !== "replace"
      && !(patch?.type === "bind" && isSystemBindAnchor(patchAnchor(patch))));
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
      registerPatchTree(patch, virtualPatchById);
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
      ensureOriginalUpdateRenderable(patch, state, registry, virtualPatchById);
      if (patch?.id || patch?.name) {
        const id = patch.id || patch.name;
        // Cumulative ledger: this state's patch carries every modification
        // since the original implementation, so its render is self-contained.
        const base = virtualPatchById.get(id) || previousSpec || {};
        patch.modifications_applied = mergeModificationLists(
          base.modifications_applied || base.modifications,
          patch.modifications
        );
        virtualPatchById.set(id, { ...base, ...patch, props: { ...(base.props || {}), ...(patch.props || {}) } });
      }
    }
    for (const patch of state.patches) {
      normalizePatchAnchorRefs(patch, idToAnchor);
      normalizeNestedChildLayout(patch);
      normalizeComponentProps(patch);
      normalizeRichContentRequirements(patch);
      normalizeRichRequirements(patch);
      normalizeFixedViewportPatch(patch, initialHeight, bottomRef);
    }
    const requestedHeight = Number(state.height);
    const contentHeight = stateContentBottom(state);
    state.height = Math.max(
      Number(initialHeight) || 0,
      Number.isFinite(requestedHeight) ? requestedHeight : 0,
      contentHeight
    );
  }

  autoKeepUpdatedCards(model, registry);
  return model;
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
  if (patch?.layout?.group) return true;
  if (patchChildren(patch).length) return true;
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

  function isSystemTrigger(trigger) {
    if (!trigger || typeof trigger !== "object") return false;
    return /timeout|load_complete|submit_success|system|auto|data_loaded|success|完成|系统|自动/i.test(JSON.stringify(trigger));
  }

  for (const state of sorted) {
    if (!state.id) issues.push("state missing id");
    if (!Number.isFinite(Number(state.height)) || Number(state.height) <= 0) issues.push(`${state.id} missing numeric height`);
    const contentBottom = stateContentBottom(state);
    if (Number(state.height || 0) < contentBottom) issues.push(`${state.id} height ${state.height} smaller than content bottom ${contentBottom}`);
    if (stateNum(state.id) > 1 && !state.parent_state) issues.push(`${state.id} missing parent_state`);
    if (stateNum(state.id) === 1 && !state.parent_state && state.trigger) issues.push(`${state.id} initial state must not define trigger`);
    if (stateNum(state.id) === 1 && !state.parent_state
      && ((state.inheritance?.create || []).length || (state.inheritance?.update || []).length)) {
      // state_1 is the original captured page rendered from app-root; page-layer
      // does not render its create/update components, so any bind to them is
      // dead. First-screen interactions must target original DOM anchors.
      issues.push(`${state.id} is the original captured page and must not create/update components; bind first-screen interactions to original DOM anchors instead`);
    }
    if (stateNum(state.id) > 1 && state.trigger && !isSystemTrigger(state.trigger)) {
      const triggerAction = state.trigger.action || state.trigger.event;
      if (isClickAction(triggerAction)) {
        const triggerTarget = gotoStateNum(state.trigger.goto) || gotoStateNum(state.trigger.action);
        if (triggerTarget !== stateNum(state.id)) {
          issues.push(`${state.id} click trigger must explicitly goto its own state id`);
        }
      }
    }
    if (state.inheritance?.hide) issues.push(`${state.id} must not output inheritance.hide`);
    if (state.inheritance?.replace) issues.push(`${state.id} must not output inheritance.replace`);
    for (const patch of state.inheritance?.create || []) validatePatchShape(patch, state.id, issues);
    for (const patch of state.inheritance?.update || []) validatePatchShape(patch, state.id, issues);
    for (const patch of state.patches || []) validatePatchShape(patch, state.id, issues);
    validateStateStacking(state, registry, virtualPatches, issues);

    const refs = [];
    if (state.trigger?.anchor && !isSystemTrigger(state.trigger)) refs.push(state.trigger.anchor);
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
    for (const patch of state.patches || []) {
      if (patch.type === "create") {
        collectPatchIds(patch).forEach((id) => virtualAnchors.add(id));
        registerPatchTree(patch, virtualPatches);
        const topId = patch?.id || patch?.name;
        if (topId) topLevelCreatedIds.add(topId);
        recordContainerChildren(patch, containerChildParent);
      }
      if (patch.type === "bind" && !patchGotoStateNum(patch)) issues.push(`${state.id} bind patch must include explicit goto state target`);
      if (patch.type === "hide" || patch.type === "replace") issues.push(`${state.id} must not contain ${patch.type} patch`);
    }
    // A bind's anchor must resolve to a real element (original DOM anchor or a
    // virtual component visible in this state), otherwise the runtime cannot
    // attach the click and the transition is dead. Checked after all create ids
    // above are registered into virtualAnchors.
    for (const patch of state.patches || []) {
      if (patch.type !== "bind") continue;
      const bindAnchor = patch.anchor || patch.target_anchor;
      if (typeof bindAnchor === "string" && bindAnchor
        && !originalAnchors.has(bindAnchor) && !virtualAnchors.has(bindAnchor)) {
        issues.push(`${state.id} bind references unknown anchor: ${bindAnchor}`);
      }
    }
  }

  return issues;
}

async function callLLM({ model, system, user, maxTokens }) {
  loadDotEnv(path.join(SKILL_ROOT, ".env"));
  loadDotEnv(path.join(ROOT, "backend", ".env"));
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY or OPENAI_API_KEY");

  const base = (process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          temperature: Number(process.env.MODEL_TEMPERATURE ?? 0),
          seed: Number(process.env.MODEL_SEED ?? 42),
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }),
      });

      const body = await response.text();
      if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${body.slice(0, 1000)}`);
      const json = JSON.parse(body);
      return json.choices?.[0]?.message?.content || "";
    } catch (err) {
      lastErr = err;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
  throw lastErr;
}

async function main() {
  const args = process.argv.slice(2);
  const base = path.resolve(ROOT, args[0] || "new_test/2");
  const model = argValue(args, "--model", "qwen3.7-max");
  const width = Number(argValue(args, "--width", "360"));
  const height = Number(argValue(args, "--height", "792"));
  const blueprintPath = path.resolve(ROOT, argValue(args, "--blueprint", latestBlueprint(base)));
  const registryPath = path.resolve(ROOT, argValue(args, "--registry", path.join(base, ".preprocess", "semantic_registry.json")));
  const out = path.resolve(ROOT, argValue(args, "--out", path.join(base, ".run_skill", "state_implementation", "state_implementation_model.llm.json")));
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
