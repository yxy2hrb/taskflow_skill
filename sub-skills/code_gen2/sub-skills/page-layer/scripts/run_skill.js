// LLM-generated React + AntD static state-layer runner.
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const { injectStateKeyNavIntoFile } = require("../../../../../scripts/inject_state_key_nav");
const {
  loadSkillEnv,
  configureNodePath,
  resolveArgPath,
  exists,
} = require("../../../../../scripts/paths");
const { callJsonChat, resolveTextModel } = require("../../../../../scripts/llm_config");

// Viewport width of the page being generated. Set once in main() from --width.
// Used to derive a concrete bbox from a semantic layout.widthHint
// (full-width / half-width-left / half-width-right) for ORIGINAL DOM anchor
// updates whose placement changed but that did not get an explicit set_bbox.
let TF_PAGE_WIDTH = 360;

function readUtf8(file) { return fs.readFileSync(file, "utf8"); }
function readJson(file) { return JSON.parse(readUtf8(file)); }
function writeUtf8(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, "utf8"); }
function writeJson(file, value) { writeUtf8(file, JSON.stringify(value, null, 2)); }
function argValue(args, name, fallback) { const idx = args.indexOf(name); return idx >= 0 ? args[idx + 1] : fallback; }
function rel(file) { return path.relative(process.cwd(), file).replace(/\\/g, "/"); }
function stateNum(id) { const m = String(id || "").match(/(\d+)/); return m ? Number(m[1]) : 0; }
function extractBlock(html, tag) { const m = String(html || "").match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "i")); return m ? m[0] : ""; }
function extractBodyInner(html) { const m = String(html || "").match(/<body[^>]*>([\s\S]*?)<\/body>/i); return m ? m[1] : String(html || ""); }

function designSystemCss() {
  const file = path.resolve(__dirname, "../../../resources/global.css");
  if (!exists(file)) return "";
  return readUtf8(file)
    .replace(/@import[^\n]+\n/g, "")
    .replace(/@tailwind[^\n]+\n/g, "")
    .trim();
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

async function callLLM({ model, system, user, maxTokens }) {
  return callJsonChat({ model, system, user, maxTokens, label: "page-layer" });
}

function slimRegistry(registry) {
  const out = {};
  for (const [name, item] of Object.entries(registry.semantic_dom_registry || {})) {
    out[name] = {
      selector: item.selector,
      bbox: item.bbox,
      area: item.area,
      component: item.component || item.semantic,
      text: item.text || "",
      policy: item.inheritance_policy,
    };
  }
  return out;
}

function slimStateModel(model) {
  return {
    states: (model.states || []).map((state) => ({
      id: state.id,
      label: state.label,
      ui_intent: state.ui_intent,
      height: Number(state.height) || null,
      parent_state: state.parent_state,
      triggers: state.triggers || [],
      inheritance: {
        keep: state.inheritance?.keep || [],
        create: state.inheritance?.create || [],
        update: state.inheritance?.update || [],
      },
    })),
  };
}

function normalizeBlueprint(input, model) {
  if (input?.meta && Array.isArray(input.states)) return input;
  if (input?.merged_states_by_id) {
    return {
      states: Object.values(input.merged_states_by_id)
        .map((s) => ({ state_id: stateNum(s.id), state_name: s.label || s.id, description: s.description || "" }))
        .filter((s) => s.state_id > 0)
        .sort((a, b) => a.state_id - b.state_id),
    };
  }
  return { states: (model.states || []).map((s) => ({ state_id: stateNum(s.id), state_name: s.label || s.id, description: s.ui_intent || "" })) };
}

function heightForState(model, stateId, fallback) {
  const n = stateNum(stateId);
  const state = (model.states || []).find((item) => stateNum(item.id) === n);
  const height = Number(state?.height);
  return Number.isFinite(height) && height > 0 ? height : fallback;
}

function truncateText(value, limit = 5000) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit)}\n/* truncated */` : text;
}

function slimComponentCodegen(componentCodegen) {
  if (!componentCodegen?.components?.length) return null;
  return {
    ok: componentCodegen.ok === true,
    source_state_model: componentCodegen.source_state_model || null,
    components: componentCodegen.components.map((record) => {
      const inputComponent = record.input?.component || {};
      const renderedComponent = record.component || {};
      return {
        state_id: record.state_id,
        operation: record.operation,
        id: renderedComponent.id || inputComponent.id || inputComponent.name || null,
        component: inputComponent.component || renderedComponent.component || null,
        bbox: inputComponent.bbox || renderedComponent.bbox || null,
        layout: inputComponent.layout || null,
        props: inputComponent.props || null,
        content_density: inputComponent.content_density || null,
        content_requirements: inputComponent.content_requirements || [],
        is_top_level: record.input?.is_top_level !== false,
        generated_children: (record.input?.generated_children || []).map((child) => ({
          id: child.id || null,
          component: child.component || null,
          importName: child.importName || null,
          importPath: child.importPath || null,
        })),
        text: inputComponent.text || renderedComponent.text || renderedComponent.visible_text || null,
        description: inputComponent.description || renderedComponent.description || null,
        reactCode: truncateText(renderedComponent.reactCode, record.input?.is_top_level === false ? 1500 : 3500),
        issues: record.issues || [],
      };
    }),
  };
}

function buildPromptInput({ registry, model, blueprint, componentCodegen, width, height }) {
  return {
    viewport: {
      width,
      initial_height: height,
      width_locked: true,
      height_may_expand: true,
    },
    blueprint: normalizeBlueprint(blueprint, model),
    semantic_registry: slimRegistry(registry),
    state_implementation_model: slimStateModel(model),
    component_codegen: slimComponentCodegen(componentCodegen),
    global_css: truncateText(designSystemCss(), 12000),
  };
}

function hasStateSection(html, stateId) {
  return new RegExp(`<section\\b[^>]*id=["']tf-state-${stateNum(stateId)}["']`).test(String(html || ""));
}

function validateGenerated(parsed, stateModel) {
  const issues = [];
  if (!parsed || typeof parsed !== "object") issues.push("response is not object");
  if (typeof parsed.html !== "string" || !parsed.html.includes("tf-state-")) issues.push("missing html tf-state layers");
  if (typeof parsed.css !== "string") issues.push("missing css string");
  for (const state of stateModel.states || []) {
    if (stateNum(state.id) > 1 && !hasStateSection(parsed?.html, state.id)) {
      issues.push(`missing section for ${state.id}`);
    }
  }
  return issues;
}

function validatePlaceholderGenerated(parsed, stateModel) {
  const issues = validateGenerated(parsed, stateModel);
  const html = String(parsed?.html || "");
  const renderedComponentRe = /<([a-z][\w:-]*)\b(?=[^>]*\bdata-component-id=["'][^"']+["'])(?![^>]*\btf-component-placeholder\b)[^>]*>/gi;
  const matches = [...html.matchAll(renderedComponentRe)];
  if (matches.length) {
    issues.push(`LLM output must use component placeholders only, found inline component roots: ${matches.slice(0, 5).map((m) => m[0].slice(0, 80)).join(" | ")}`);
  }
  return issues;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function componentRecordId(record) {
  return record?.component?.id || record?.input?.component?.id || record?.input?.component?.name || "";
}

function componentRecordStateNum(record) {
  return stateNum(record?.state_id);
}

function validBboxArray(bbox) {
  const values = Array.isArray(bbox) ? bbox.map(Number) : [];
  return values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0;
}

function latestComponentRecord(componentCodegen, id, stateId) {
  const current = stateNum(stateId);
  return (componentCodegen?.components || [])
    .filter((record) => componentRecordId(record) === id && componentRecordStateNum(record) <= current)
    .sort((a, b) => componentRecordStateNum(b) - componentRecordStateNum(a))[0] || null;
}

function latestComponentRecordWithBbox(componentCodegen, id, stateId) {
  const current = stateNum(stateId);
  return (componentCodegen?.components || [])
    .filter((record) => componentRecordId(record) === id && componentRecordStateNum(record) <= current)
    .filter((record) => validBboxArray(record?.input?.component?.bbox || record?.component?.bbox))
    .sort((a, b) => componentRecordStateNum(b) - componentRecordStateNum(a))[0] || null;
}

function latestComponentRecordWithLayout(componentCodegen, id, stateId) {
  const current = stateNum(stateId);
  return (componentCodegen?.components || [])
    .filter((record) => {
      const spec = record?.input?.component || {};
      return componentRecordId(record) === id
        && componentRecordStateNum(record) < current
        && spec?.layout?.group;
    })
    .sort((a, b) => componentRecordStateNum(b) - componentRecordStateNum(a))[0] || null;
}

// The latest record that actually carries a component SPEC. Reuse records
// (operation "reuse"/"update" with only { reused_from }) drop input.component,
// so they lose layout/bbox metadata. A kept component in a later state must
// fall back to the most recent state that truly (re)generated it, otherwise it
// renders unpositioned and collapses to the top of the layer.
function latestComponentRecordWithSpec(componentCodegen, id, stateId) {
  const current = stateNum(stateId);
  return (componentCodegen?.components || [])
    .filter((record) => componentRecordId(record) === id
      && componentRecordStateNum(record) <= current
      && record?.input?.component
      && (record.input.component.id || record.input.component.name))
    .sort((a, b) => componentRecordStateNum(b) - componentRecordStateNum(a))[0] || null;
}

function isTopLevelComponentRecord(record) {
  return record?.input?.is_top_level !== false;
}

function bboxContainsBbox(outer, inner, tol = 1) {
  if (!validBboxArray(outer) || !validBboxArray(inner)) return false;
  return outer[0] <= inner[0] + tol
    && outer[1] <= inner[1] + tol
    && outer[0] + outer[2] >= inner[0] + inner[2] - tol
    && outer[1] + outer[3] >= inner[1] + inner[3] - tol;
}

function originalAnchorUpdatePatch(state, registry, id) {
  if (!id || !registry?.semantic_dom_registry?.[id]) return null;
  if ((state.inheritance?.create || []).some((patch) => (patch?.id || patch?.name) === id)) return null;
  return (state.inheritance?.update || []).find((patch) => (patch?.id || patch?.name) === id) || null;
}

// Unified card-update pipeline: an update on an original anchor is rendered
// by cloning the card's previous implementation (the original region) and
// applying the patch's cumulative modification ledger inside the clone —
// text, text style, and position changes are machine-applicable. Only an
// update that introduces structure or content the clone cannot express
// (children, rich content, business props) goes through component-codegen,
// which regenerates the whole card from the patch.
function patchModifications(patch) {
  return [
    ...(Array.isArray(patch?.modifications_applied) ? patch.modifications_applied : []),
    ...(Array.isArray(patch?.modifications) ? patch.modifications : []),
  ];
}

// Machine-applicable set_props keys for original-DOM keep clones (same set
// tfApplyCardLedgers can apply at runtime without regenerating the card).
const ORIGINAL_ANCHOR_SIMPLE_PROP_KEYS = /^(color|opacity|visibility|display|fontSize|fontWeight|fontStyle|backgroundColor|layoutRole|zIndex|clearable|checked|selected)$/i;

// A single modification on an original DOM anchor that tfApplyCardLedgers can
// apply inside the keep clone: set_text / set_bbox / set_text_style, optional
// cosmetic set_props, or delete. Metadata-only entries (change/target_component
// with no set_* payload) are no-ops and also skip codegen. Child paths like
// "children.<domId>" are allowed when the payload is simple.
function isSimpleOriginalAnchorModification(mod) {
  if (!mod || typeof mod !== "object") return true;
  if (String(mod.type || "") === "create") return false;
  if (String(mod.type || "") === "delete") return true;
  const hasText = typeof mod.set_text === "string";
  const hasBbox = Array.isArray(mod.set_bbox) && mod.set_bbox.length === 4;
  const hasStyle = mod.set_text_style && typeof mod.set_text_style === "object" && !Array.isArray(mod.set_text_style);
  const sp = mod.set_props && typeof mod.set_props === "object" && !Array.isArray(mod.set_props) ? mod.set_props : null;
  if (sp) {
    const keys = Object.keys(sp);
    if (keys.some((key) => !ORIGINAL_ANCHOR_SIMPLE_PROP_KEYS.test(key))) return false;
  }
  if (!hasText && !hasBbox && !hasStyle && !sp) return true;
  return true;
}

// Original DOM anchor updates: only regenerate when the patch introduces
// structure/content the keep clone cannot express. Simple text/bbox/style (and
// cosmetic prop) deltas are applied at runtime in tfApplyCardLedgers.
function originalAnchorUpdateNeedsCodegen(patch) {
  if (Array.isArray(patch?.children) && patch.children.length) return true;
  if (String(patch?.content_density || "").toLowerCase() === "rich") return true;
  const props = patch?.props && typeof patch.props === "object" && !Array.isArray(patch.props) ? patch.props : {};
  if (Object.keys(props).some((key) => !/^(layoutRole|zIndex)$/i.test(key))) return true;
  for (const mod of patchModifications(patch)) {
    if (!isSimpleOriginalAnchorModification(mod)) return true;
  }
  return false;
}

function updateNeedsCodegen(patch) {
  if (Array.isArray(patch?.children) && patch.children.length) return true;
  if (String(patch?.content_density || "").toLowerCase() === "rich") return true;
  const props = patch?.props && typeof patch.props === "object" && !Array.isArray(patch.props) ? patch.props : {};
  if (Object.keys(props).some((key) => !/^(layoutRole|zIndex)$/i.test(key))) return true;
  for (const mod of patchModifications(patch)) {
    if (!mod || typeof mod !== "object") continue;
    if (String(mod.type || "") === "create") return true;
    if (mod.target_component) return true;
    const target = String(mod.target || "");
    if (target === "children" || target.startsWith("children.")) return true;
    if (target === "props" || target.startsWith("props.")) return true;
    const sp = mod.set_props && typeof mod.set_props === "object" && !Array.isArray(mod.set_props) ? mod.set_props : null;
    if (sp) {
      const keys = Object.keys(sp);
      if (keys.some((key) => /^(variant|items|loading|skeleton|body|sections|filters|activeId|title|moreText|primaryLabel|disabled)$/i.test(key))) return true;
      if (keys.some((key) => !/^(color|opacity|visibility|display|fontSize|fontWeight|fontStyle|backgroundColor|layoutRole|zIndex|clearable|checked|selected)$/i.test(key))) return true;
    }
  }
  return false;
}

function isOriginalAnchorUpdate(state, registry, id) {
  const patch = originalAnchorUpdatePatch(state, registry, id);
  if (!patch) return false;
  return !originalAnchorUpdateNeedsCodegen(patch);
}

function stateExpectedComponentIds(state, componentCodegen, registry) {
  const out = [];
  function add(id) {
    if (id && !out.includes(id)) out.push(id);
  }
  // Kept virtual components are the inherited base page and must render below
  // current-state overlays, masks, sheets, and dialogs.
  for (const item of state.inheritance?.keep || []) {
    const record = typeof item === "string" ? latestComponentRecord(componentCodegen, item, state.id) : null;
    if (record && isTopLevelComponentRecord(record)) add(item);
  }
  for (const item of state.inheritance?.update || []) {
    const id = item?.id || item?.name;
    if (registry && isOriginalAnchorUpdate(state, registry, id)) continue;
    add(id);
  }
  for (const item of state.inheritance?.create || []) add(item?.id || item?.name);
  return out;
}

function sectionHasComponent(sectionHtml, id) {
  const escaped = escapeRegExp(id);
  const re = new RegExp(`<[^>]+data-component-id=["']${escaped}["'][^>]*>`, "g");
  return [...String(sectionHtml || "").matchAll(re)].some((match) => !/\btf-component-placeholder\b/.test(match[0]));
}

function injectMissingComponentHtml(sectionHtml, snippets) {
  if (!snippets.length) return sectionHtml;
  const insertion = snippets.join("");
  const keepPattern = /(<div\b[^>]*class=["'][^"']*\btf-keep-placeholder\b[^"']*["'][^>]*><\/div>\s*)+/i;
  if (keepPattern.test(sectionHtml)) {
    return sectionHtml.replace(keepPattern, (match) => match + insertion);
  }
  return sectionHtml.replace(/(<section\b[^>]*>)/i, `$1${insertion}`);
}

function componentPlaceholder(id) {
  return `<div class="tf-component-placeholder" data-component-id="${String(id).replace(/"/g, "&quot;")}"></div>`;
}

function layoutComponentSpecsForState(state, componentCodegen, registry) {
  const keptVirtualSpecs = (state.inheritance?.keep || [])
    .filter((id) => typeof id === "string")
    .map((id) => componentLayoutSpec(state, componentCodegen, id, registry))
    .filter(Boolean);
  const byId = new Map();
  for (const spec of [...keptVirtualSpecs, ...(state.inheritance?.create || []), ...(state.inheritance?.update || [])]) {
    const id = spec?.id || spec?.name;
    if (id) byId.set(id, spec);
  }
  return [...byId.values()]
    .map((spec) => {
      const id = spec?.id || spec?.name;
      return id ? componentLayoutSpec(state, componentCodegen, id, registry) || spec : spec;
    })
    .filter((spec) => {
      const id = spec?.id || spec?.name;
      return id
        && spec?.layout?.group
        && !Array.isArray(spec.bbox)
        && !isBottomActionBarSpec(spec)
        && !isBottomSheetSpec(spec)
        && !isOverlaySpec(spec);
    });
}

function flowLayoutGroupsForState(state, componentCodegen, registry) {
  const groups = new Map();
  for (const spec of layoutComponentSpecsForState(state, componentCodegen, registry)) {
    const key = String(spec.layout.group);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(spec);
  }
  return [...groups.entries()].map(([group, specs]) => ({
    group,
    specs: specs.sort((a, b) => Number(a.layout?.order || 0) - Number(b.layout?.order || 0)),
  }));
}

// Merge "chained" flow groups: when group B's startAnchor points to a member
// that lives inside another flow group A (an auto-height member with no bbox),
// the static `flowGroupTop` cannot measure A's rendered bottom and would place
// B at the page top — overlapping A. Instead we splice B's specs into A so the
// whole chain renders as ONE absolutely-positioned flex column and stacks
// naturally. The merged group inherits A's head spec (resolvable bbox anchor)
// for top/spacing, and concatenates each original group's already order-sorted
// specs in chain order (anchor-owner first), so cross-group `order` values
// never reshuffle members across the boundary.
function mergedFlowLayoutGroupsForState(state, componentCodegen, registry) {
  const groups = flowLayoutGroupsForState(state, componentCodegen, registry);
  if (groups.length <= 1) return groups;
  const idToGroupIdx = new Map();
  groups.forEach((group, idx) => {
    for (const spec of group.specs) idToGroupIdx.set(spec.id || spec.name, idx);
  });
  // predecessor[idx] = index of the group that owns this group's startAnchor.
  const predecessor = new Array(groups.length).fill(-1);
  const successors = new Map();
  groups.forEach((group, idx) => {
    const anchor = flowStartAnchor(group);
    if (!anchor) return;
    const ownerIdx = idToGroupIdx.get(anchor);
    if (ownerIdx == null || ownerIdx === idx) return;
    predecessor[idx] = ownerIdx;
    if (!successors.has(ownerIdx)) successors.set(ownerIdx, []);
    successors.get(ownerIdx).push(idx);
  });
  const visited = new Set();
  const merged = [];
  const walk = (idx, chainSpecs, chainNames) => {
    if (visited.has(idx)) return;
    visited.add(idx);
    for (const spec of groups[idx].specs) chainSpecs.push(spec);
    chainNames.push(groups[idx].group);
    for (const succ of (successors.get(idx) || []).slice().sort((a, b) => a - b)) {
      walk(succ, chainSpecs, chainNames);
    }
  };
  groups.forEach((group, idx) => {
    if (predecessor[idx] >= 0 || visited.has(idx)) return; // only start chains at heads
    const chainSpecs = [];
    const chainNames = [];
    walk(idx, chainSpecs, chainNames);
    if (chainNames.length <= 1) {
      merged.push(group);
    } else {
      merged.push({ group: chainNames.join("+"), groups: chainNames, specs: chainSpecs, merged: true });
    }
  });
  // Safety: any group left unvisited (e.g. an anchor cycle) is emitted as-is.
  groups.forEach((group, idx) => {
    if (visited.has(idx)) return;
    visited.add(idx);
    merged.push(group);
  });
  return merged;
}

function flowLayoutIdsForState(state, componentCodegen, registry) {
  const ids = new Set();
  for (const group of flowLayoutGroupsForState(state, componentCodegen, registry)) {
    for (const spec of group.specs) ids.add(spec.id || spec.name);
  }
  return ids;
}

function componentSpecById(state, id) {
  return [...(state.inheritance?.create || []), ...(state.inheritance?.update || [])]
    .find((spec) => (spec?.id || spec?.name) === id) || null;
}

function flowStartAnchor(group) {
  for (const spec of group.specs) {
    const value = String(spec.layout?.startAnchor || "");
    const match = value.match(/^below:(.+)$/i);
    if (match) return match[1];
  }
  return "";
}

function bboxForAnchor(registry, anchor) {
  if (!registry || !anchor) return null;
  const semantic = registry.semantic_dom_registry || {};
  const direct = semantic[anchor];
  if (Array.isArray(direct?.bbox)) return direct.bbox.map(Number);
  const selector = registry.semanticAnchors?.[anchor];
  if (selector) {
    const bySelector = Object.values(semantic).find((item) => item?.selector === selector || `#${item?.id}` === selector);
    if (Array.isArray(bySelector?.bbox)) return bySelector.bbox.map(Number);
    const byKey = semantic[String(selector).replace(/^#/, "")] || semantic[selector];
    if (Array.isArray(byKey?.bbox)) return byKey.bbox.map(Number);
  }
  const fuzzy = Object.entries(semantic).find(([name]) => name.includes(anchor) || anchor.includes(name));
  if (Array.isArray(fuzzy?.[1]?.bbox)) return fuzzy[1].bbox.map(Number);
  return null;
}

function flowGroupTop(state, group, registry, componentCodegen, overrides = null) {
  const spacing = Number(group.specs[0]?.layout?.spacingHint ?? 12) || 12;
  const anchor = flowStartAnchor(group);
  const anchorOverride = anchor ? heightOverrideFor(overrides, stateNum(state.id), anchor) : null;
  const anchorSpec = anchor ? componentSpecById(state, anchor) : null;
  const bbox = Array.isArray(anchorSpec?.bbox) ? anchorSpec.bbox.map(Number) : null;
  if (bbox && bbox.every(Number.isFinite)) {
    const effH = Number.isFinite(anchorOverride) ? anchorOverride : bbox[3];
    return Math.max(0, bbox[1] + effH + spacing);
  }
  const componentBbox = anchor ? componentLayoutSpec(state, componentCodegen, anchor, registry)?.bbox : null;
  const anchorBbox = Array.isArray(componentBbox) ? componentBbox.map(Number) : null;
  if (anchorBbox && anchorBbox.every(Number.isFinite)) {
    const effH = Number.isFinite(anchorOverride) ? anchorOverride : anchorBbox[3];
    return Math.max(0, anchorBbox[1] + effH + spacing);
  }
  const registryBbox = bboxForAnchor(registry, anchor);
  if (registryBbox && registryBbox.every(Number.isFinite)) return Math.max(0, registryBbox[1] + registryBbox[3] + spacing);
  let maxBottom = 0;
  for (const spec of [...(state.inheritance?.create || []), ...(state.inheritance?.update || [])]) {
    if (!Array.isArray(spec?.bbox) || isBottomActionBarSpec(spec) || isBottomSheetSpec(spec) || isOverlaySpec(spec)) continue;
    const itemBbox = spec.bbox.map(Number);
    if (itemBbox.every(Number.isFinite)) maxBottom = Math.max(maxBottom, itemBbox[1] + itemBbox[3]);
  }
  return maxBottom + spacing;
}

function flowGroupPlaceholder(group, state, registry, componentCodegen, overrides = null) {
  const spacing = Number(group.specs[0]?.layout?.spacingHint ?? 12) || 12;
  const top = flowGroupTop(state, group, registry, componentCodegen, overrides);
  const style = [
    "position:absolute",
    "left:0px",
    `top:${top}px`,
    "width:100%",
    "padding:0 12px 96px",
    "display:flex",
    "flex-direction:column",
    `gap:${spacing}px`,
    "box-sizing:border-box",
  ].join(";");
  return `<div class="tf-flow-group" data-flow-group="${escapeHtmlAttr(group.group)}" style="${style}">${group.specs.map((spec) => componentPlaceholder(spec.id || spec.name)).join("")}</div>`;
}

function componentPlaceholdersForState(state, componentCodegen, registry, overrides = null) {
  const groups = mergedFlowLayoutGroupsForState(state, componentCodegen, registry);
  if (!groups.length) return stateExpectedComponentIds(state, componentCodegen, registry).map(componentPlaceholder).join("");
  const groupById = new Map();
  for (const group of groups) {
    for (const spec of group.specs) groupById.set(spec.id || spec.name, group);
  }
  const emittedGroups = new Set();
  const out = [];
  for (const id of stateExpectedComponentIds(state, componentCodegen, registry)) {
    const group = groupById.get(id);
    if (group) {
      if (!emittedGroups.has(group.group)) {
        emittedGroups.add(group.group);
        out.push(flowGroupPlaceholder(group, state, registry, componentCodegen, overrides));
      }
      continue;
    }
    out.push(componentPlaceholder(id));
  }
  return out.join("");
}

function escapeHtmlAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeHtmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function htmlTextContent(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function directPatchForComponent(state, id) {
  for (const patch of state.inheritance?.create || []) {
    if ((patch?.id || patch?.name) === id) return patch;
  }
  for (const patch of state.inheritance?.update || []) {
    if ((patch?.id || patch?.name) === id) return patch;
  }
  return null;
}

// Extract a self/anchor-targeted set_bbox from an update patch's modification
// ledger: a modification whose target is the patch root itself (empty, "self",
// "bbox", the patch id, or "children.<patchId>") carrying a 4-tuple set_bbox.
// This is the placement an original-anchor update declares for ITSELF.
function selfBboxFromPatch(patch) {
  if (!patch) return null;
  const selfId = patch.id || patch.name;
  const lists = [patch.modifications_applied, patch.modifications];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const mod of list) {
      if (!mod || !Array.isArray(mod.set_bbox) || mod.set_bbox.length !== 4) continue;
      const t = String(mod.target || "");
      if (!t || t === "self" || t === "bbox" || t === selfId || t === "children." + selfId) {
        const bbox = mod.set_bbox.map(Number);
        if (validBboxArray(bbox)) return bbox;
      }
    }
  }
  return null;
}

function widthHintChanged(direct, previous) {
  const cur = String(direct?.layout?.widthHint || "");
  if (!cur) return false;
  return cur !== String(previous?.layout?.widthHint || "");
}

// Derive a concrete [x,y,w,h] from a semantic widthHint, reusing the y/height of
// a base bbox (previous or registry placement). Keeps absolute positioning while
// only changing the WIDTH band (full vs half-left vs half-right). 16px side
// margins and a 12px inter-column gap match the flow-group padding.
function deriveBboxFromWidthHint(direct, baseBbox) {
  const hint = String(direct?.layout?.widthHint || "").toLowerCase();
  if (!hint || !Array.isArray(baseBbox) || baseBbox.length !== 4) return null;
  const [, y, , h] = baseBbox.map(Number);
  if (![y, h].every(Number.isFinite)) return null;
  const side = 16;
  const gap = 12;
  const full = Math.max(0, TF_PAGE_WIDTH - side * 2);
  const half = Math.max(0, Math.round((full - gap) / 2));
  if (/full|safe-area|content-column/.test(hint)) return [side, y, full, h];
  if (/right/.test(hint)) return [side + half + gap, y, half, h];
  if (/left|half/.test(hint)) return [side, y, half, h];
  return null;
}

function componentLayoutSpec(state, componentCodegen, id, registry) {
  const direct = directPatchForComponent(state, id);
  if (direct) {
    const previous = (
      latestComponentRecordWithBbox(componentCodegen, id, state.id)
      || latestComponentRecordWithLayout(componentCodegen, id, state.id)
    )?.input?.component || {};
    const registryBbox = bboxForAnchor(registry, id);
    // Placement priority for an original/virtual anchor update:
    //   1. explicit patch.bbox
    //   2. a self-targeted set_bbox in the modification ledger
    //   3. when the patch declares a NEW widthHint, derive the band from the
    //      previous/registry bbox (never silently fall back to the OLD width)
    //   4. previous bbox, then registry bbox
    const baseBbox = Array.isArray(previous.bbox) ? previous.bbox : registryBbox;
    const selfBbox = selfBboxFromPatch(direct);
    const derived = (!selfBbox && !Array.isArray(direct.bbox) && widthHintChanged(direct, previous))
      ? deriveBboxFromWidthHint(direct, baseBbox)
      : null;
    // Self-targeted set_bbox in the modification ledger beats a stale patch.bbox
    // copied from registry (e.g. half-width 156 still on patch while set_bbox
    // declares full-width 328).
    const resolvedBbox = selfBbox
      || (Array.isArray(direct.bbox) ? direct.bbox : null)
      || derived
      || previous.bbox
      || registryBbox;
    return {
      ...previous,
      ...direct,
      bbox: resolvedBbox,
      layout: direct.layout || previous.layout,
      props: { ...(previous.props || {}), ...(direct.props || {}) },
    };
  }
  const latest = latestComponentRecordWithSpec(componentCodegen, id, state.id)?.input?.component || null;
  if (!latest) return null;
  const previous = (
    (Array.isArray(latest.bbox) ? null : latestComponentRecordWithBbox(componentCodegen, id, state.id))
    || (latest?.layout?.group ? null : latestComponentRecordWithLayout(componentCodegen, id, state.id))
  )?.input?.component || {};
  return {
    ...previous,
    ...latest,
    bbox: Array.isArray(latest.bbox) ? latest.bbox : previous.bbox,
    layout: latest.layout || previous.layout,
    props: { ...(previous.props || {}), ...(latest.props || {}) },
  };
}

function renderArticleDetailFallback(spec) {
  if (String(spec?.component || "").toLowerCase() !== "articledetail") return null;
  const props = spec.props || {};
  const sections = Array.isArray(props.sections) ? props.sections : [];
  if (!sections.length && !props.title && !props.loading) return null;
  const body = props.loading
    ? Array.from({ length: 6 }).map((_, index) => `<div style="height:${index % 3 === 0 ? 20 : 14}px;width:${index % 3 === 0 ? 70 : 96}%;background:#eceff3;border-radius:8px;margin:14px 0"></div>`).join("")
    : sections.map((section) => {
        const type = String(section?.type || "paragraph").toLowerCase();
        if (type === "heading") return `<h3 style="font-size:17px;line-height:24px;margin:18px 0 8px;color:#111;font-weight:700">${escapeHtmlText(section.text)}</h3>`;
        if (type === "image") return `<div style="height:176px;border-radius:12px;background:#eef1f5;color:#8a8f99;display:flex;align-items:center;justify-content:center;margin:14px 0;font-size:13px">${escapeHtmlText(section.caption || "文档配图")}</div>`;
        return `<p style="font-size:15px;line-height:24px;margin:10px 0;color:#333;white-space:pre-wrap">${escapeHtmlText(section.text || section.caption || "")}</p>`;
      }).join("");
  return `<article data-component-id="${escapeHtmlAttr(spec.id || spec.name || "article_detail")}" class="tf-cg-article-detail-fallback" style="position:relative;width:100%;min-height:600px;margin-top:92px;padding:16px;background:#fff;box-sizing:border-box;color:#111">
    ${props.title ? `<h2 style="font-size:22px;line-height:30px;margin:0 0 8px;font-weight:700">${escapeHtmlText(props.title)}</h2>` : ""}
    ${body}
  </article>`;
}

function componentHtmlForState(record, state, id, componentCodegen, registry) {
  const spec = componentLayoutSpec(state, componentCodegen, id, registry);
  const html = record?.component?.html;
  const fallback = renderArticleDetailFallback(spec);
  if (fallback && (!html || htmlTextContent(html).length < 8)) return fallback;
  return html;
}

function isBottomActionBarSpec(spec) {
  const layoutRole = String(spec?.props?.layoutRole ?? spec?.layoutRole ?? "");
  if (/^fixed-bottom-(action|keyboard)$/i.test(layoutRole)) return true;
  // A bare `ButtonBar` is NOT automatically a viewport-pinned bottom bar: only
  // pin when state_implementation stamped a fixed-bottom layoutRole (above) or
  // the id/component is explicitly a bottom/action bar. An inline ButtonBar
  // action row stays in the page flow / its authored bbox.
  return /bottomactionbar|bottom_action_bar/i.test(String(spec?.component || ""))
    || /(^|_)bottom(_|-)bar$|bottom_bar|bottom-action-bar/i.test(String(spec?.id || spec?.name || ""));
}

function isBottomSheetSpec(spec) {
  return /bottomsheet|bottom_sheet/i.test(String(spec?.component || ""))
    || /(^|_)sheet$|bottom_sheet|bottom-sheet/i.test(String(spec?.id || spec?.name || ""));
}

function isFloatingPanelSpec(spec) {
  return isBottomSheetSpec(spec)
    || /dialog|modal|drawer|popup|popover/i.test(String(spec?.component || ""))
    || /dialog|modal|drawer|popup|popover/i.test(String(spec?.id || spec?.name || ""));
}

function isOverlaySpec(spec) {
  return /overlay|mask|scrim/i.test(String(spec?.component || ""))
    || /overlay|mask|scrim/i.test(String(spec?.id || spec?.name || ""));
}

// A centered overlay container (Dialog/Modal/Popover, not a bottom-anchored
// sheet/drawer) whose author set heightMode:"auto" must size to its content so
// its header/body/footer is never clipped by a guessed fixed bbox height.
function frameUsesAutoHeight(spec) {
  const value = String(spec?.component || spec?.id || spec?.name || "").toLowerCase();
  if (/bottomsheet|bottom_sheet|bottom-sheet|drawer/.test(value)) return false;
  if (!/dialog|modal|popover|popup/.test(value)) return false;
  const mode = String(spec?.props?.heightMode ?? spec?.layout?.heightMode ?? "").toLowerCase();
  return mode === "auto" || mode === "content";
}

function isKeyboardSpec(spec) {
  return /softkeyboard|keyboard|ime/i.test(String(spec?.component || ""))
    || /soft[_-]?keyboard|keyboard|ime/i.test(String(spec?.id || spec?.name || ""));
}

// Components that must be positioned against the viewport (fixed bottom bar,
// soft keyboard, floating panel, overlay/mask). For these the page-layer frame
// owns placement; a frame the LLM may have wrapped with `position:absolute`
// page coordinates must NOT be reused, or the element lands in the scrolling
// canvas instead of pinned to the screen edge.
function isViewportFixedSpec(spec) {
  if (!spec) return false;
  return isBottomActionBarSpec(spec) || isKeyboardSpec(spec) || isFloatingPanelSpec(spec) || isOverlaySpec(spec);
}

function componentEverCreated(stateModel, id) {
  for (const state of stateModel?.states || []) {
    for (const item of state.inheritance?.create || []) {
      if ((item?.id || item?.name) === id) return true;
    }
  }
  return false;
}

// A component id that was never created as a top-level component and resolves
// with no usable placement (no fixed bbox, no flow layout group, no fixed role)
// is an "orphan". These come from the model wrongly promoting an internal child
// control (e.g. a button/input embedded in a container's props) into a
// standalone update patch. Rendering them yields an unpositioned node that falls
// to the top-left of the page, so they must be skipped.
function isUnplaceableOrphanComponent(state, stateModel, componentCodegen, registry, id) {
  if (!id) return false;
  if (componentEverCreated(stateModel, id)) return false;
  const spec = componentLayoutSpec(state, componentCodegen, id, registry);
  if (!spec) return false;
  const hasBbox = Array.isArray(spec.bbox) && spec.bbox.length === 4 && spec.bbox.every((v) => Number.isFinite(Number(v)));
  const hasLayout = Boolean(spec?.layout?.group);
  if (hasBbox || hasLayout) return false;
  if (isViewportFixedSpec(spec)) return false;
  return true;
}

function explicitComponentZIndex(spec) {
  const zIndex = Number(spec?.props?.zIndex ?? spec?.zIndex);
  return Number.isFinite(zIndex) ? zIndex : null;
}

// Highest z-index used by the runtime keep layer (tfKeepZIndexFor returns 0 for
// background/decoration keeps and 1 for normal keeps). Regenerated original-anchor
// update frames must sit ABOVE this to not be occluded by their kept ancestor
// container.
const KEEP_LAYER_TOP_Z = 1;

// Pixels by which a measured natural content height must undercut the authored
// bbox height before the runner shrinks a frame. Avoids churn on rounding noise.
const HEIGHT_FIT_TOLERANCE = 6;

// Media / aspect-ratio components carry an intentional display height (a carousel
// or banner is sized for its image area, not its DOM content). Auto-fit must not
// collapse these to their placeholder content height, so they are excluded from
// height measurement overrides and keep the authored bbox height.
const MEDIA_COMPONENT_RE = /(carousel|swiper|slider|gallery|banner|hero|cover|image|img|photo|picture|video|media|map|avatar|thumbnail|qrcode|qr_code)/i;

function isMediaSpec(spec) {
  return MEDIA_COMPONENT_RE.test(String(spec?.component || spec?.id || spec?.name || ""));
}

// True when this state's update on an original anchor explicitly SET an opaque
// background fill (e.g. a video region whose cover image is swapped for a black
// playback surface via set_props.background:#000000). The fill IS the intended
// display, so the authored bbox height is meaningful: content-height auto-fit
// would see only the overlaid controls and wrongly collapse the region. Such
// containers must keep their authored bbox height, like media components.
function CSS_TRANSPARENT_VALUE_RE() {
  return /^(transparent|none|inherit|initial|unset)$/i;
}
function isOpaqueBackgroundValue(value) {
  const val = String(value == null ? "" : value).trim();
  if (!val || CSS_TRANSPARENT_VALUE_RE().test(val)) return false;
  // A fully transparent rgba()/hsla() (alpha 0) is not an opaque fill.
  if (/(?:rgba|hsla)\([^)]*,\s*0(?:\.0+)?\s*\)/i.test(val)) return false;
  return true;
}
function updateSetsExplicitBackground(state, registry, id) {
  const patch = originalAnchorUpdatePatch(state, registry, id);
  if (!patch) return false;
  for (const mod of patchModifications(patch)) {
    const sp = mod && typeof mod === "object" && mod.set_props
      && typeof mod.set_props === "object" && !Array.isArray(mod.set_props)
      ? mod.set_props : null;
    if (!sp) continue;
    for (const key of Object.keys(sp)) {
      if (!/^background(-?color)?$/i.test(key)) continue;
      if (isOpaqueBackgroundValue(sp[key])) return true;
    }
  }
  return false;
}

function heightOverrideFor(overrides, stateNumValue, id) {
  if (!overrides || typeof overrides.get !== "function") return null;
  const value = overrides.get(`${stateNumValue}::${id}`);
  return Number.isFinite(value) ? value : null;
}

function componentFrameStyle(spec, zIndexOverride = null, heightOverride = null) {
  const bbox = Array.isArray(spec?.bbox) ? spec.bbox.map(Number) : null;
  if (!validBboxArray(bbox)) return "";
  const forcedZ = Number(zIndexOverride);
  const zIndex = Number.isFinite(forcedZ) ? forcedZ : explicitComponentZIndex(spec);
  const zStyle = Number.isFinite(zIndex) ? `z-index:${zIndex}` : "";
  // Page-layer owns viewport positioning for fixed surfaces, but z-index order
  // remains authored by state_implementation/component-codegen. The runner only
  // syncs that authored z-index onto outer frames so nested stacking contexts do
  // not hide higher inner components.
  if (isKeyboardSpec(spec)) {
    return [
      "position:fixed",
      "left:0px",
      "bottom:0px",
      `width:${bbox[2]}px`,
      `height:${bbox[3]}px`,
      zStyle,
    ].filter(Boolean).join(";");
  }
  if (isBottomActionBarSpec(spec)) {
    return [
      "position:fixed",
      "left:0px",
      "bottom:0px",
      `width:${bbox[2]}px`,
      `height:${bbox[3]}px`,
      zStyle,
    ].filter(Boolean).join(";");
  }
  if (isBottomSheetSpec(spec)) {
    return [
      "position:fixed",
      `left:${bbox[0]}px`,
      "bottom:0px",
      `width:${bbox[2]}px`,
      `height:${bbox[3]}px`,
      zStyle,
    ].filter(Boolean).join(";");
  }
  if (isOverlaySpec(spec)) {
    return [
      "position:fixed",
      `left:${bbox[0]}px`,
      "top:0px",
      `width:${bbox[2]}px`,
      "height:100vh",
      zStyle,
    ].filter(Boolean).join(";");
  }
  if (isFloatingPanelSpec(spec)) {
    if (frameUsesAutoHeight(spec)) {
      return [
        "position:fixed",
        `left:${bbox[0]}px`,
        `top:${bbox[1]}px`,
        `width:${bbox[2]}px`,
        "height:auto",
        `min-height:${bbox[3]}px`,
        `max-height:calc(100vh - ${Math.max(0, bbox[1])}px - 16px)`,
        "overflow:auto",
        zStyle,
      ].filter(Boolean).join(";");
    }
    return [
      "position:fixed",
      `left:${bbox[0]}px`,
      `top:${bbox[1]}px`,
      `width:${bbox[2]}px`,
      `height:${bbox[3]}px`,
      zStyle,
    ].filter(Boolean).join(";");
  }
  const frameHeight = Number.isFinite(heightOverride) ? heightOverride : bbox[3];
  return [
    "position:absolute",
    `left:${bbox[0]}px`,
    `top:${bbox[1]}px`,
    `width:${bbox[2]}px`,
    `height:${frameHeight}px`,
    zStyle,
  ].filter(Boolean).join(";");
}

function parseStyleZIndex(style) {
  const match = String(style || "").match(/(?:^|;)\s*z-index\s*:\s*([-+]?\d+(?:\.\d+)?)\s*(?:;|$)/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
}

function rootHtmlZIndex(html) {
  const tag = (String(html || "").match(/<[^!][^>]*>/) || [])[0] || "";
  const style = (tag.match(/\bstyle=["']([^"']*)["']/i) || [])[1] || "";
  return parseStyleZIndex(style);
}

function syncedFrameZIndex(spec, html = "") {
  const candidates = [explicitComponentZIndex(spec), rootHtmlZIndex(html)]
    .filter((value) => Number.isFinite(value));
  return candidates.length ? Math.max(...candidates) : null;
}

function statePatchIds(state, field) {
  return new Set((state.inheritance?.[field] || [])
    .map((item) => typeof item === "string" ? item : item?.id || item?.name)
    .filter(Boolean));
}

function wrapComponentHtml(html, { id, state, componentCodegen, registry }) {
  const spec = componentLayoutSpec(state, componentCodegen, id, registry);
  const style = componentFrameStyle(spec, syncedFrameZIndex(spec, html));
  if (!style) return html;
  const frameClass = frameUsesAutoHeight(spec) ? "tf-component-frame tf-auto-height" : "tf-component-frame";
  return `<div class="${frameClass}" data-component-frame="${escapeHtmlAttr(id)}" style="${style}">${html}</div>`;
}

function placeholderAlreadyHasFrame(sectionHtml, offset) {
  const prefix = String(sectionHtml || "").slice(Math.max(0, offset - 800), offset);
  const lastFrame = prefix.lastIndexOf("tf-component-frame");
  if (lastFrame < 0) return false;
  const lastClose = prefix.lastIndexOf("</div>");
  return lastFrame > lastClose;
}

function placeholderFrameHasCompleteBbox(sectionHtml, offset) {
  const prefix = String(sectionHtml || "").slice(Math.max(0, offset - 1200), offset);
  const lastFrame = prefix.lastIndexOf("tf-component-frame");
  if (lastFrame < 0) return false;
  const tagStart = prefix.lastIndexOf("<", lastFrame);
  const tagEnd = prefix.indexOf(">", lastFrame);
  if (tagStart < 0 || tagEnd < 0) return false;
  const tag = prefix.slice(tagStart, tagEnd + 1);
  const style = (tag.match(/\bstyle=["']([^"']*)["']/i) || [])[1] || "";
  return /position\s*:\s*(absolute|fixed)/i.test(style)
    && /left\s*:/i.test(style)
    && /top\s*:/i.test(style)
    && /width\s*:/i.test(style)
    && /height\s*:/i.test(style);
}

function keepPlaceholdersForState(state, componentCodegen) {
  // Anchors that are ALSO update targets are rendered (at their new bbox) by the
  // runtime card-update mount; emitting a plain keep placeholder here would draw
  // a second copy at the ORIGINAL position, so exclude them.
  const updatedIds = new Set((state.inheritance?.update || [])
    .map((patch) => patch?.id || patch?.name)
    .filter(Boolean));
  return (state.inheritance?.keep || [])
    .filter((anchor) => {
      if (typeof anchor !== "string") return false;
      if (updatedIds.has(anchor)) return false;
      const record = latestComponentRecord(componentCodegen, anchor, state.id);
      return !record || !isTopLevelComponentRecord(record);
    })
    .map((anchor) => `<div class="tf-keep-placeholder" data-keep-anchor="${String(anchor).replace(/"/g, "&quot;")}"></div>`)
    .join("");
}

function statusKeepAnchors(registry) {
  return Object.entries(registry.semantic_dom_registry || {})
    .filter(([anchor, entry]) => {
      const text = `${anchor} ${entry?.component || ""} ${entry?.element || ""}`;
      const bbox = Array.isArray(entry?.bbox) ? entry.bbox.map(Number) : [];
      const isTopSmallRegion = Number.isFinite(bbox[1]) && Number.isFinite(bbox[3]) && bbox[1] <= 40 && bbox[3] <= 40;
      if (!/状态栏|status|电池|系统图标|信号/i.test(text)) return false;
      if (!isTopSmallRegion) return false;
      return !/导航|标题|navbar|nav\s*bar|title/i.test(text);
    })
    .map(([anchor]) => anchor);
}

function isSystemBottomKeepAnchor(anchor, registry) {
  const text = String(anchor || "");
  if (!/底部系统|系统导航条|home[-_\s]?indicator|home\s*indicator|底部home/i.test(text)) return false;
  const bbox = bboxForAnchor(registry, anchor);
  if (!Array.isArray(bbox)) return true;
  const y = Number(bbox[1]);
  const h = Number(bbox[3]);
  return !Number.isFinite(y) || !Number.isFinite(h) || h <= 40;
}

// A full-screen replacement state builds its own page header (TopNav/title bar)
// and lays down its own full content, rather than floating over the previous
// page. Such a state must NOT keep the previous page's content anchors as a
// background — only system-resident bars (status bar) survive. Overlay/sheet/
// dialog states are excluded: they legitimately keep the page behind them.
function isSelfHeaderReplacementState(state, componentCodegen) {
  if (!state || stateNum(state.id) <= 1) return false;
  if (isOverlayState(state)) return false;
  const creates = state.inheritance?.create || [];
  if (creates.length < 2) return false;
  return creates.some((spec) =>
    /topnav|top[_-]?nav|navbar|nav[_-]?bar|titlebar|title[_-]?bar/i.test(String(spec?.component || spec?.id || spec?.name || "")));
}

function expectedKeepAnchorsForState(state, componentCodegen, registry) {
  const anchors = [];
  function add(anchor) {
    if (anchor && !anchors.includes(anchor)) anchors.push(anchor);
  }
  const fullScreenReplace = isSelfHeaderReplacementState(state, componentCodegen);
  const systemTop = fullScreenReplace ? new Set(statusKeepAnchors(registry)) : null;
  // Update targets own their own (moved) render via the runtime card-update
  // mount; keeping them here too would duplicate the card at its old position.
  const updatedIds = new Set((state.inheritance?.update || [])
    .map((patch) => patch?.id || patch?.name)
    .filter(Boolean));
  for (const anchor of state.inheritance?.keep || []) {
    if (typeof anchor !== "string") continue;
    if (updatedIds.has(anchor)) continue;
    if (isSystemBottomKeepAnchor(anchor, registry)) continue;
    const record = latestComponentRecord(componentCodegen, anchor, state.id);
    if (record && isTopLevelComponentRecord(record)) continue;
    // Drop inherited original-content keeps for full-screen replacement states
    // so the previous page (state_1) is not retained as a ghost background.
    if (fullScreenReplace && !systemTop.has(anchor)) continue;
    add(anchor);
  }
  if (stateNum(state.id) > 1) {
    for (const anchor of statusKeepAnchors(registry)) add(anchor);
  }
  return anchors;
}

function keepPlaceholder(anchor) {
  return `<div class="tf-keep-placeholder" data-keep-anchor="${String(anchor).replace(/"/g, "&quot;")}"></div>`;
}

function keepPlaceholderRegex(anchor) {
  const escaped = escapeRegExp(anchor);
  return new RegExp(`<div\\b(?=[^>]*\\btf-keep-placeholder\\b)(?=[^>]*\\bdata-keep-anchor=["']${escaped}["'])[^>]*>\\s*<\\/div>\\s*`, "g");
}

function buildRuleGenerated(stateModel, componentCodegen, registry, overrides = null) {
  const sections = [];
  for (const state of stateModel.states || []) {
    const n = stateNum(state.id);
    if (n <= 1) continue;
    const keeps = keepPlaceholdersForState(state, componentCodegen);
    const components = componentPlaceholdersForState(state, componentCodegen, registry, overrides);
    sections.push(`<section id="tf-state-${n}" class="tf-state-layer tf-llm-layer" style="display:none">${keeps}${components}</section>`);
  }
  return {
    html: sections.join(""),
    css: "",
    reactCode: "",
    validation_notes: "Rule-generated page layer: sections, keep placeholders, and top-level component placeholders were built directly from state_implementation_model and recursive component_codegen. Nested children are rendered inside their parent components. No LLM invocation was used.",
  };
}

function componentSnippetsForState(state, componentCodegen, appendedCss, registry) {
  const snippets = [];
  for (const id of stateExpectedComponentIds(state, componentCodegen, registry)) {
    const record = latestComponentRecord(componentCodegen, id, state.id);
    const html = componentHtmlForState(record, state, id, componentCodegen, registry);
    if (typeof html !== "string" || !html.trim()) continue;
    snippets.push(wrapComponentHtml(html, { id, state, componentCodegen, registry }));
    if (record.component.css) appendedCss.push(`\n/* component-codegen fallback: ${id} */\n${scopeComponentCssToState(record.component.css, state.id)}`);
  }
  return snippets;
}

function ensureStateSectionCoverage(generated, stateModel, componentCodegen, registry, overrides = null) {
  if (!generated || typeof generated.html !== "string") return generated;
  const appendedCss = [];
  const sections = [];
  for (const state of stateModel.states || []) {
    if (stateNum(state.id) <= 1 || hasStateSection(generated.html, state.id)) continue;
    const keeps = expectedKeepAnchorsForState(state, componentCodegen, registry).map(keepPlaceholder).join("");
    const placeholders = componentPlaceholdersForState(state, componentCodegen, registry, overrides);
    sections.push(`<section id="tf-state-${stateNum(state.id)}" class="tf-state-layer tf-llm-layer" style="display:none">${keeps}${placeholders}</section>`);
  }
  if (sections.length) {
    generated.html = `${generated.html}${sections.join("")}`;
    generated.validation_notes = [generated.validation_notes, `Runner inserted missing sections: ${sections.length}.`]
      .filter(Boolean)
      .join(" ");
  }
  return generated;
}

function ensureKeepPlaceholderCoverage(generated, stateModel, componentCodegen, registry) {
  if (!generated || typeof generated.html !== "string") return generated;
  let inserted = 0;
  let removed = 0;
  generated.html = generated.html.replace(/<section\b[^>]*id=["']tf-state-(\d+)["'][\s\S]*?<\/section>/g, (sectionHtml, n) => {
    const state = (stateModel.states || []).find((item) => stateNum(item.id) === Number(n));
    if (!state || stateNum(state.id) <= 1) return sectionHtml;
    const expectedKeeps = expectedKeepAnchorsForState(state, componentCodegen, registry);
    const expectedSet = new Set(expectedKeeps);
    let next = sectionHtml.replace(/<div\b(?=[^>]*\btf-keep-placeholder\b)(?=[^>]*\bdata-keep-anchor=["']([^"']+)["'])[^>]*>\s*<\/div>\s*/g, (match, anchor) => {
      if (expectedSet.has(anchor)) return match;
      removed += 1;
      return "";
    });
    const missing = expectedKeeps
      .filter((anchor) => !new RegExp(`data-keep-anchor=["']${escapeRegExp(anchor)}["']`).test(next));
    if (!missing.length) return next;
    inserted += missing.length;
    return next.replace(/(<section\b[^>]*>)/i, `$1${missing.map(keepPlaceholder).join("")}`);
  });
  if (inserted || removed) {
    generated.validation_notes = [generated.validation_notes, `Runner normalized keep placeholders: inserted ${inserted}, removed ${removed}.`]
      .filter(Boolean)
      .join(" ");
  }
  return generated;
}

function flowPlaceholderRegex(id) {
  const escaped = escapeRegExp(id);
  return new RegExp(`<div\\b(?=[^>]*\\btf-component-placeholder\\b)(?=[^>]*\\bdata-component-id=["']${escaped}["'])[^>]*>\\s*<\\/div>`, "g");
}

function normalizeFlowLayoutPlaceholders(generated, stateModel, componentCodegen, registry) {
  if (!generated || typeof generated.html !== "string") return generated;
  let changed = false;
  generated.html = generated.html.replace(/<section\b[^>]*id=["']tf-state-(\d+)["'][\s\S]*?<\/section>/g, (sectionHtml, n) => {
    const state = (stateModel.states || []).find((item) => stateNum(item.id) === Number(n));
    if (!state) return sectionHtml;
    const groups = mergedFlowLayoutGroupsForState(state, componentCodegen, registry);
    if (!groups.length) return sectionHtml;
    // Grouped specs live ONLY inside the tf-flow-group div (the Option A skeleton
    // nests them, and the missingGroups branch below regex-removes any root-level
    // flow placeholders before inserting the group), so no root-level duplicates
    // remain to hide — the former suppressRules CSS hide-hack is gone.
    const missingGroups = groups.filter((group) => !new RegExp(`\\bdata-flow-group=["']${escapeRegExp(group.group)}["']`).test(sectionHtml));
    if (!missingGroups.length) return sectionHtml;
    let next = sectionHtml;
    const flowIds = new Set();
    for (const group of missingGroups) {
      for (const spec of group.specs) flowIds.add(spec.id || spec.name);
    }
    for (const id of flowIds) next = next.replace(flowPlaceholderRegex(id), "");
    for (const group of missingGroups) {
      const placeholder = flowGroupPlaceholder(group, state, registry, componentCodegen);
      const anchor = flowStartAnchor(group);
      if (anchor) {
        const anchorMatch = [...next.matchAll(flowPlaceholderRegex(anchor))].pop();
        if (anchorMatch) {
          const index = anchorMatch.index + anchorMatch[0].length;
          next = `${next.slice(0, index)}${placeholder}${next.slice(index)}`;
          continue;
        }
      }
      const keepPattern = /(<div\b[^>]*class=["'][^"']*\btf-keep-placeholder\b[^"']*["'][^>]*><\/div>\s*)+/i;
      if (keepPattern.test(next)) {
        next = next.replace(keepPattern, (match) => match + placeholder);
      } else {
        next = next.replace(/(<section\b[^>]*>)/i, `$1${placeholder}`);
      }
    }
    if (next !== sectionHtml) changed = true;
    return next;
  });
  if (changed) {
    generated.validation_notes = [generated.validation_notes, "Runner normalized flow layout placeholders into positioned groups."]
      .filter(Boolean)
      .join(" ");
  }
  return generated;
}

function fillComponentPlaceholders(generated, stateModel, componentCodegen, registry, overrides = null) {
  if (!generated || typeof generated.html !== "string" || !componentCodegen?.components?.length) return generated;
  const appendedCss = [];
  let changed = false;
  const unmatched = [];
  const placeholderRe = /<div\b(?=[^>]*\btf-component-placeholder\b)(?=[^>]*\bdata-component-id=["'][^"']+["'])[^>]*>\s*<\/div>/g;
  generated.html = generated.html.replace(/<section\b[^>]*id=["']tf-state-(\d+)["'][\s\S]*?<\/section>/g, (sectionHtml, n) => {
    const state = (stateModel.states || []).find((item) => stateNum(item.id) === Number(n));
    if (!state) return sectionHtml;
    return sectionHtml.replace(placeholderRe, (placeholder, offset, fullSectionHtml) => {
      const id = (placeholder.match(/\bdata-component-id=["']([^"']+)["']/) || [])[1];
      if (isUnplaceableOrphanComponent(state, stateModel, componentCodegen, registry, id)
        || isOriginalAnchorUpdate(state, registry, id)) {
        changed = true;
        return "";
      }
      const record = latestComponentRecord(componentCodegen, id, state.id);
      const html = componentHtmlForState(record, state, id, componentCodegen, registry);
      if (typeof html !== "string" || !html.trim()) {
        // No component-codegen record (or empty render) matched this placeholder.
        // This usually means the component_codegen output and the state model that
        // produced these placeholders disagree on component ids (stale/mismatched
        // intermediate artifacts). Leaving the placeholder empty silently drops the
        // component, so surface it loudly instead of vanishing without a trace.
        unmatched.push(`${state.id}:${id}${record ? "(empty render)" : "(no record)"}`);
        return placeholder;
      }
      changed = true;
      if (record.component.css) appendedCss.push(`\n/* component-codegen placeholder: ${id} */\n${scopeComponentCssToState(record.component.css, state.id)}`);
      const spec = componentLayoutSpec(state, componentCodegen, id, registry);
      const framedHtml = wrapComponentHtml(html, { id, state, componentCodegen, registry });
      // Reuse an LLM-provided frame only for ordinary flow components whose frame
      // already carries a complete bbox. Viewport-fixed components (bottom bar,
      // keyboard, sheet, overlay) must always be re-framed by componentFrameStyle
      // so they pin to the screen edge instead of an absolute canvas coordinate.
      if (placeholderAlreadyHasFrame(fullSectionHtml, offset)
        && placeholderFrameHasCompleteBbox(fullSectionHtml, offset)
        && !isViewportFixedSpec(spec)) {
        return html;
      }
      return framedHtml;
    });
  });
  if (changed) {
    generated.css = `${generated.css || ""}${appendedCss.join("")}`;
    generated.validation_notes = [generated.validation_notes, "Runner filled component placeholders from component_codegen."]
      .filter(Boolean)
      .join(" ");
  }
  if (unmatched.length) {
    const warning = `Runner WARNING: ${unmatched.length} component placeholder(s) had no matching component_codegen record and were left empty (likely a state-model vs component-codegen id mismatch from stale artifacts): ${unmatched.join(", ")}`;
    console.warn(`[page-layer] ${warning}`);
    generated.validation_notes = [generated.validation_notes, warning].filter(Boolean).join(" ");
    generated.unmatched_placeholders = unmatched;
  }
  return generated;
}

function ensureComponentCodegenCoverage(generated, stateModel, componentCodegen, registry) {
  if (!generated || typeof generated.html !== "string" || !componentCodegen?.components?.length) return generated;
  const appendedCss = [];
  let patchedHtml = generated.html.replace(/<section\b[^>]*id=["']tf-state-(\d+)["'][\s\S]*?<\/section>/g, (sectionHtml, n) => {
    const state = (stateModel.states || []).find((item) => stateNum(item.id) === Number(n));
    if (!state) return sectionHtml;
    const missing = [];
    for (const id of stateExpectedComponentIds(state, componentCodegen, registry)) {
      if (sectionHasComponent(sectionHtml, id)) continue;
      if (isUnplaceableOrphanComponent(state, stateModel, componentCodegen, registry, id)) continue;
      const record = latestComponentRecord(componentCodegen, id, state.id);
      const html = componentHtmlForState(record, state, id, componentCodegen, registry);
      if (typeof html !== "string" || !html.trim()) continue;
      missing.push(wrapComponentHtml(html, { id, state, componentCodegen, registry }));
      if (record.component.css) appendedCss.push(`\n/* component-codegen fallback: ${id} */\n${scopeComponentCssToState(record.component.css, state.id)}`);
    }
    return injectMissingComponentHtml(sectionHtml, missing);
  });
  if (patchedHtml !== generated.html) {
    generated.html = patchedHtml;
    generated.css = `${generated.css || ""}${appendedCss.join("")}`;
    generated.validation_notes = [generated.validation_notes, "Runner inserted missing component_codegen snippets for state coverage."]
      .filter(Boolean)
      .join(" ");
  }
  return generated;
}

function importantInlineStyle(style) {
  return String(style || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf(":");
      if (idx < 0) return "";
      const prop = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim().replace(/\s*!important\s*$/i, "");
      return prop && value ? `${prop}:${value} !important;` : "";
    })
    .filter(Boolean)
    .join("");
}

function normalizeComponentFrameCss(generated, stateModel, componentCodegen, registry, overrides = null) {
  if (!generated || typeof generated.html !== "string" || !componentCodegen?.components?.length) return generated;
  const rules = [];
  for (const state of stateModel.states || []) {
    const stateId = stateNum(state.id);
    const keepIds = statePatchIds(state, "keep");
    const activeIds = new Set([...statePatchIds(state, "create"), ...statePatchIds(state, "update")]);
    const activeSurfaceZ = [...activeIds]
      .map((id) => {
        const spec = componentLayoutSpec(state, componentCodegen, id, registry);
        if (!isViewportFixedSpec(spec)) return null;
        const record = latestComponentRecord(componentCodegen, id, state.id);
        const html = componentHtmlForState(record, state, id, componentCodegen, registry);
        return syncedFrameZIndex(spec, html);
      })
      .filter((value) => Number.isFinite(value));
    const backgroundCap = activeSurfaceZ.length ? Math.min(...activeSurfaceZ) - 1 : null;
    // Lowest z-index among ALL covering overlays present in this state (mask /
    // sheet / dialog), whether freshly created/updated OR merely kept from an
    // earlier state. The active-surface cap above only sees create/update
    // surfaces, so a kept page-level bottom action bar would otherwise float
    // above overlays that were inherited (e.g. a kept mask + sheet under a
    // dialog) instead of being covered by them.
    const coveringOverlayZ = [...keepIds, ...activeIds]
      .map((id) => {
        const spec = componentLayoutSpec(state, componentCodegen, id, registry);
        if (!isCoveringOverlaySpec(spec)) return null;
        const record = latestComponentRecord(componentCodegen, id, state.id);
        const html = componentHtmlForState(record, state, id, componentCodegen, registry);
        return syncedFrameZIndex(spec, html);
      })
      .filter((value) => Number.isFinite(value));
    const coveringOverlayMinZ = coveringOverlayZ.length ? Math.min(...coveringOverlayZ) : null;
    // Bboxes of all original-anchor update frames that will be lifted to the card
    // layer. A frame geometrically CONTAINED by another such frame (e.g. the
    // 导航标签栏 tab bar inside the 新闻内容列表区 region, both pinned at y=220)
    // must paint ABOVE its container — same containment rule the keep layer uses
    // — or the larger opaque frame hides the smaller one.
    const cardFrameBoxes = [];
    for (const id of stateExpectedComponentIds(state, componentCodegen, registry)) {
      if (!originalAnchorUpdatePatch(state, registry, id)) continue;
      const spec = componentLayoutSpec(state, componentCodegen, id, registry);
      if (isCoveringOverlaySpec(spec) || isViewportFixedSpec(spec)) continue;
      const bb = Array.isArray(spec?.bbox) ? spec.bbox.map(Number) : null;
      if (validBboxArray(bb)) cardFrameBoxes.push({ id, bbox: bb });
    }
    for (const id of stateExpectedComponentIds(state, componentCodegen, registry)) {
      const spec = componentLayoutSpec(state, componentCodegen, id, registry);
      const bbox = Array.isArray(spec?.bbox) ? spec.bbox.map(Number) : null;
      if (!validBboxArray(bbox)) continue;
      const record = latestComponentRecord(componentCodegen, id, state.id);
      const html = componentHtmlForState(record, state, id, componentCodegen, registry);
      let zIndex = syncedFrameZIndex(spec, html);
      if (keepIds.has(id) && Number.isFinite(backgroundCap) && Number.isFinite(zIndex) && zIndex > backgroundCap) {
        zIndex = backgroundCap;
      }
      // A kept bottom action bar must sit behind every covering overlay in the
      // state (including kept ones), so an inherited "加入配单" bar gets dimmed
      // under the mask instead of floating on top of the sheet/dialog.
      if (keepIds.has(id) && !activeIds.has(id) && isBottomActionBarSpec(spec)
        && Number.isFinite(coveringOverlayMinZ) && Number.isFinite(zIndex) && zIndex >= coveringOverlayMinZ) {
        zIndex = coveringOverlayMinZ - 1;
      }
      // Original-anchor UPDATES regenerated by component-codegen (e.g. a card
      // whose children were swapped for a skeleton / fresh content) render as a
      // component frame, but their kept ANCESTOR container (e.g. 新闻内容区容器)
      // sits at the keep layer (z 0..1) and would paint over them, leaving the
      // content blank. Lift these regenerated update frames above the keep layer
      // so they show on top of (and visually replace) the kept container region.
      // Stay below any covering overlay (mask / sheet / dialog) so they never
      // punch through a modal.
      if (originalAnchorUpdatePatch(state, registry, id) && !isCoveringOverlaySpec(spec) && !isViewportFixedSpec(spec)) {
        const lift = Math.max(Number.isFinite(zIndex) ? zIndex : 0, KEEP_LAYER_TOP_Z + 1);
        zIndex = Number.isFinite(coveringOverlayMinZ) ? Math.min(lift, coveringOverlayMinZ - 1) : lift;
        // Lift once more for each other card-layer frame that contains this one,
        // so a smaller, more specific update frame paints above its container.
        let depth = 0;
        for (const other of cardFrameBoxes) {
          if (other.id !== id && bboxContainsBbox(other.bbox, bbox)) depth++;
        }
        if (depth > 0) {
          const lifted = zIndex + depth;
          zIndex = Number.isFinite(coveringOverlayMinZ) ? Math.min(lifted, coveringOverlayMinZ - 1) : lifted;
        }
      }
      const heightOverride = heightOverrideFor(overrides, stateId, id);
      const style = importantInlineStyle(componentFrameStyle(spec, zIndex, heightOverride));
      if (!style) continue;
      const attr = cssAttr(id);
      const selectors = [
        `#tf-state-${stateId} > .tf-component-frame[data-component-frame="${attr}"]`,
        `#tf-state-${stateId} > .tf-component-frame:has([data-component-frame="${attr}"])`,
        `#tf-state-${stateId} > .tf-component-frame:has([data-component-id="${attr}"])`,
      ];
      rules.push(`${selectors.join(",\n")} { ${style} }`);
    }
  }
  if (!rules.length) return generated;
  generated.css = `${generated.css || ""}\n/* Normalize component outer frames from authored placement/z-index. */\n${rules.join("\n")}`;
  generated.validation_notes = [generated.validation_notes, "Runner normalized component outer frames from authored placement/z-index."]
    .filter(Boolean)
    .join(" ");
  return generated;
}

function cssAttr(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

// Component CSS is emitted once per state version of a component, but the
// class names inside it (e.g. .tf-cg-input-name) are shared by every state's
// copy of that component. Appending the raw CSS globally lets one state's
// rules leak onto other state layers — e.g. state_3's fake-caret
// `.tf-cg-input-name > div > div::after` and state_4's `.tf-cg-input-name::after`
// both painting on the same input produces a double cursor. Scope every
// selector to the owning state section.
function matchBraceEnd(css, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (!depth) return i;
    }
  }
  return css.length - 1;
}

function scopeCssBlock(css, prefix) {
  let out = "";
  let index = 0;
  while (index < css.length) {
    const brace = css.indexOf("{", index);
    if (brace < 0) {
      out += css.slice(index);
      break;
    }
    const selector = css.slice(index, brace);
    const trimmed = selector.trim();
    if (trimmed.startsWith("@")) {
      const end = matchBraceEnd(css, brace);
      if (/^@(media|supports)\b/i.test(trimmed)) {
        out += `${selector}{${scopeCssBlock(css.slice(brace + 1, end), prefix)}}`;
      } else {
        // @keyframes / @font-face pass through unscoped.
        out += css.slice(index, end + 1);
      }
      index = end + 1;
      continue;
    }
    const end = css.indexOf("}", brace);
    if (end < 0) {
      out += css.slice(index);
      break;
    }
    const scoped = trimmed
      .split(",")
      .map((sel) => {
        const single = sel.trim();
        if (!single) return single;
        if (/^(html|body|:root)\b/i.test(single)) return single;
        return `${prefix}${single}`;
      })
      .filter(Boolean)
      .join(",");
    out += `${scoped}{${css.slice(brace + 1, end)}}`;
    index = end + 1;
  }
  return out;
}

function scopeComponentCssToState(css, stateId) {
  const n = stateNum(stateId);
  const source = String(css || "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (!n || !source.trim()) return source;
  return scopeCssBlock(source, `#tf-state-${n} `);
}

function bottomActionBarComponentIds(componentCodegen) {
  const ids = [];
  for (const record of componentCodegen?.components || []) {
    // Only top-level bottom bars can be "unexpectedly inherited" between states.
    // A bottom-bar-like component nested inside a container (e.g. a ButtonBar
    // footer inside a BottomSheet) is owned and positioned by its parent and
    // must never be globally suppressed, or its action button disappears.
    if (!isTopLevelComponentRecord(record)) continue;
    const spec = record?.input?.component || record?.component || {};
    const id = spec.id || spec.name || record?.id;
    if (id && isBottomActionBarSpec(spec) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function suppressUnexpectedBottomBars(generated, stateModel, componentCodegen) {
  if (!generated || typeof generated.css !== "string" || !componentCodegen?.components?.length) return generated;
  const bottomIds = bottomActionBarComponentIds(componentCodegen);
  if (!bottomIds.length) return generated;
  const rules = [];
  for (const state of stateModel.states || []) {
    const n = stateNum(state.id);
    if (n <= 1) continue;
    const expected = new Set(stateExpectedComponentIds(state, componentCodegen));
    for (const id of bottomIds) {
      if (expected.has(id)) continue;
      const safe = cssAttr(id);
      rules.push(`#tf-state-${n} [data-component-frame="${safe}"],#tf-state-${n} [data-component-id="${safe}"]{display:none!important;visibility:hidden!important;pointer-events:none!important}`);
    }
  }
  if (!rules.length) return generated;
  generated.css = `${generated.css || ""}\n/* Hide inherited bottom bars that do not belong to the active state. */\n${rules.join("\n")}`;
  generated.validation_notes = [generated.validation_notes, "Runner suppressed unexpected inherited bottom action bars per state."]
    .filter(Boolean)
    .join(" ");
  return generated;
}

// A surface that visually covers the page beneath it: a full-screen overlay /
// scrim / mask, a bottom sheet, or a modal/dialog/drawer/popover.
function isCoveringOverlaySpec(spec) {
  return isOverlaySpec(spec)
    || isBottomSheetSpec(spec)
    || /modal|dialog|drawer|popup|popover/i.test(String(spec?.component || spec?.id || spec?.name || ""));
}

function isOverlayState(state) {
  return [...(state.inheritance?.create || []), ...(state.inheritance?.update || [])]
    .some((spec) => isCoveringOverlaySpec(spec));
}

function normalizeKeepPlaceholderCss(generated) {
  if (!generated || typeof generated.css !== "string") return generated;
  const before = generated.css;
  generated.css = generated.css
    .replace(/[^{}]*\.tf-keep-placeholder[^{}]*\{[^{}]*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)[^{}]*\}/gi, "")
    .replace(/[^{}]*\[data-keep-anchor\][^{}]*\{[^{}]*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)[^{}]*\}/gi, "");
  generated.css = `${generated.css || ""}\n.tf-llm-layer .tf-keep-placeholder,.tf-llm-layer [data-keep-anchor]{display:block!important;visibility:visible!important;opacity:1!important;}`;
  if (generated.css !== before) {
    generated.validation_notes = [generated.validation_notes, "Runner normalized keep placeholder visibility."]
      .filter(Boolean)
      .join(" ");
  }
  return generated;
}

function buildHtml({ originalHtml, registry, generated, stateModel, width, height }) {
  const head = extractBlock(originalHtml, "head") || "<head><meta charset=\"utf-8\"></head>";
  // NOTE: the base page is the CLEAN initial state. Any full-screen popup
  // backdrop ("全屏半透明遮罩层") that exists in the source D2C must NOT be
  // re-injected here, or it pollutes state_1 and every keep clone. Popup states
  // create their own overlay (overlay_mask) explicitly via the state model.
  const body = extractBodyInner(originalHtml);
  const runtimeModel = slimStateModel(stateModel);
  const stateLayerCss = (stateModel.states || [])
    .map((state) => {
      const n = stateNum(state.id);
      if (n <= 1) return "";
      const background = isOverlayState(state) ? "transparent" : "#f5f5f5";
      let css = `#tf-state-${n}{--tf-state-content-height:${heightForState(stateModel, state.id, height)}px;background:${background}!important;}`;
      // When a soft keyboard and a fixed bottom action bar coexist in the same
      // state, lift the action bar above the keyboard so its button stays
      // visible and clickable (mirrors real mobile keyboards pushing the bar up).
      const patches = [...(state.inheritance?.create || []), ...(state.inheritance?.update || [])];
      const keyboard = patches.find((p) => p && isKeyboardSpec(p));
      const kbBbox = Array.isArray(keyboard?.bbox) ? keyboard.bbox.map(Number) : null;
      const kbHeight = kbBbox && Number.isFinite(kbBbox[3]) ? kbBbox[3] : 0;
      if (keyboard && kbHeight > 0) {
        for (const bar of patches.filter((p) => p && !isKeyboardSpec(p) && isBottomActionBarSpec(p))) {
          const id = cssAttr(bar.id || bar.name || "");
          if (!id) continue;
          // Only the frame (position:fixed) is lifted. Do NOT target the inner
          // [data-component-id] node — it is position:relative, so `bottom` would
          // offset it upward and fling the button to the top of the screen.
          css += `\n#tf-state-${n} [data-component-frame="${id}"]{bottom:${kbHeight}px!important;}`;
        }
      }
      return css;
    })
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
${head}
<body>
<div id="app-root">${body}</div>
<div id="tf-layer-root">${generated.html || ""}</div>
<style id="tf-llm-base-style">
.tf-state-layer{position:fixed!important;left:0!important;top:0!important;width:${width}px!important;height:100vh!important;z-index:9999!important;background:#f5f5f5;color:#1f1f1f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;overflow-y:auto;overflow-x:hidden;padding-bottom:88px}
.tf-llm-layer *{box-sizing:border-box}
.tf-keep-placeholder{position:absolute;overflow:hidden;pointer-events:none;z-index:0}
.tf-keep-placeholder>.tf-keep-crop{position:absolute;pointer-events:none}
.tf-component-frame{position:absolute;box-sizing:border-box}
/* Frames and flow groups are layout wrappers, not interactive surfaces. An
   LLM-authored wrapper frame left around a runner re-framed fixed component
   (keyboard, bottom bar) is a transparent box floating over the page; if it
   took pointer events it would swallow clicks meant for components beneath it.
   Children re-enable pointer events, and bindings on frames still fire through
   bubbling from those children. */
.tf-llm-layer .tf-component-frame,.tf-llm-layer .tf-flow-group{pointer-events:none}
.tf-llm-layer .tf-component-frame>*,.tf-llm-layer .tf-flow-group>*{pointer-events:auto}
.tf-component-frame>[data-component-id]{position:relative!important;left:auto!important;top:auto!important;width:100%!important;max-width:100%!important;height:100%!important;box-sizing:border-box;z-index:auto!important}
.tf-component-frame.tf-auto-height{display:flex!important;flex-direction:column!important}
.tf-component-frame.tf-auto-height>[data-component-id]{height:auto!important;min-height:100%!important;flex:1 1 auto!important}
.tf-component-frame>[data-component-id*="keyboard"],.tf-component-frame>[data-component-id*="Keyboard"],.tf-component-frame>.tf-cg-keyboard{position:absolute!important;left:0!important;right:0!important;top:0!important;bottom:0!important;width:100%!important;height:100%!important;max-width:100%!important}
.tf-state-layer>[data-component-id*="keyboard"],.tf-state-layer>[data-component-id*="Keyboard"],.tf-state-layer>.tf-cg-keyboard{position:fixed!important;left:0!important;right:0!important;bottom:0!important;top:auto!important;width:100%!important;z-index:150!important}
.tf-component-frame>[data-component-id*="sheet"].tf-cg-sheet-overlay{background:transparent!important}
.tf-component-frame>[data-component-id*="sheet"]>.tf-cg-mask,.tf-component-frame>[data-component-id*="sheet"] .tf-cg-mask,.tf-component-frame>[data-component-id*="sheet"]>.tf-cg-sheet-mask,.tf-component-frame>[data-component-id*="sheet"] .tf-cg-sheet-mask{display:none!important}
.tf-component-frame>[data-component-id*="sheet"]>[style*="color-mask"],.tf-component-frame>[data-component-id*="sheet"]>[class*="mask"]{display:none!important}
.tf-component-frame>[data-component-id*="sheet"]{overflow:hidden!important}
.tf-component-frame>[data-component-id*="sheet"] .tf-cg-sheet,.tf-component-frame>[data-component-id*="sheet"] .tf-cg-sheet-container,.tf-component-frame>[data-component-id*="sheet"] .tf-cg-sheet-panel,.tf-component-frame>[data-component-id*="sheet"] .tf-cg-bottom-sheet,.tf-component-frame>[data-component-id*="sheet"]>[class*="sheet"]:not([class*="body"]):not([class*="footer"]):not([class*="header"]):not([class*="mask"]):not([class*="overlay"]):not([class*="container"]){position:absolute!important;left:0!important;top:0!important;bottom:0!important;width:100%!important;height:100%!important;max-height:100%!important;display:flex!important;flex-direction:column!important;transform:none!important;animation:none!important}
.tf-component-frame>[data-component-id*="sheet"] .tf-cg-sheet-body{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important}
.tf-component-frame>[data-component-id*="sheet"] .tf-cg-body{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important}
.tf-component-frame>[data-component-id*="sheet"] .tf-cg-sheet-footer{flex:0 0 auto!important}
.tf-component-frame>[data-component-id*="sheet"] .tf-cg-footer{flex:0 0 auto!important}
.tf-component-frame>[data-component-frame*="bottom_bar"] .flex-1,.tf-component-frame>[data-component-frame*="button_bar"] .flex-1,.tf-component-frame>[data-component-id*="bottom_bar"] .flex-1,.tf-component-frame>[data-component-id*="button_bar"] .flex-1{min-width:0!important}
.tf-component-frame>[data-component-frame*="bottom_bar"] [style*="min-width: 120"],.tf-component-frame>[data-component-frame*="button_bar"] [style*="min-width: 120"],.tf-component-frame>[data-component-id*="bottom_bar"] [style*="min-width: 120"],.tf-component-frame>[data-component-id*="button_bar"] [style*="min-width: 120"]{min-width:0!important}
	${stateLayerCss}
${designSystemCss()}
${generated.css || ""}
</style>
<script>
window.__TF_REGISTRY__=${JSON.stringify(registry.semantic_dom_registry || {})};
window.__TF_ANCHORS__=${JSON.stringify(registry.semanticAnchors || {})};
window.__TF_STATE_MODEL__=${JSON.stringify(runtimeModel)};
function tfNum(id){
  const match=String(id||"").match(/(\\d+)/);
  return match?Number(match[1]):0;
}
function tfCssEscape(value){
  if(window.CSS && typeof window.CSS.escape==="function") return window.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g,"\\\\$&");
}
function tfPx(value){
  const n=Number(value||0);
  return Number.isFinite(n)?n:0;
}
function tfStyleNumber(el,name){
  if(!el) return NaN;
  const inline=el.style && el.style[name];
  if(inline) return parseFloat(inline);
  const computed=window.getComputedStyle?window.getComputedStyle(el):null;
  return computed ? parseFloat(computed[name]) : NaN;
}
function tfStateById(id){
  const model=window.__TF_STATE_MODEL__ || {};
  return (model.states||[]).find(function(state){ return state.id===id; }) || null;
}
function tfSourceSpec(state, anchor){
  if(!state || !state.inheritance) return null;
  const lists=[state.inheritance.create||[],state.inheritance.update||[]];
  for(const list of lists){
    const hit=list.find(function(item){ return item && item.id===anchor; });
    if(hit) return hit;
  }
  return null;
}
function tfAncestorStates(stateNumber){
  const out=[];
  let state=tfStateById("state_"+stateNumber);
  const seen=new Set();
  while(state && state.parent_state && !seen.has(state.parent_state)){
    seen.add(state.parent_state);
    const parent=tfStateById(state.parent_state);
    if(!parent) break;
    out.push(parent);
    state=parent;
  }
  return out;
}
function tfFindVirtualNode(sourceLayer, anchor, spec){
  if(!sourceLayer) return null;
  const escaped=tfCssEscape(anchor);
  const direct=sourceLayer.querySelector("#"+escaped+",[data-component-id='"+String(anchor).replace(/'/g,"\\\\'")+"']");
  if(direct) return direct;
  if(spec && Array.isArray(spec.bbox)){
    const bbox=spec.bbox.map(tfPx);
    const candidates=sourceLayer.querySelectorAll("[style]");
    for(const node of candidates){
      const left=tfStyleNumber(node,"left");
      const top=tfStyleNumber(node,"top");
      const width=tfStyleNumber(node,"width");
      const height=tfStyleNumber(node,"height");
      if(Math.abs(left-bbox[0])<=1 && Math.abs(top-bbox[1])<=1 && Math.abs(width-bbox[2])<=1 && Math.abs(height-bbox[3])<=1) {
        return node;
      }
    }
  }
  if(spec && /app_bar|nav_bar|navbar|header/i.test(String(spec.component||""))) {
    return sourceLayer.querySelector(".tf-llm-appbar,.tf-appbar,.tf-app_bar,.tf-navbar,.tf-nav_bar,.tf-header");
  }
  return null;
}
function tfFillVirtualKeep(slot, layer, anchor){
  const stateNumber=tfNum(layer && layer.id);
  const ancestors=tfAncestorStates(stateNumber);
  for(const state of ancestors){
    const spec=tfSourceSpec(state, anchor);
    if(!spec) continue;
    const sourceLayer=document.getElementById("tf-state-"+tfNum(state.id));
    const source=tfFindVirtualNode(sourceLayer, anchor, spec);
    if(!source) continue;
    const bbox=Array.isArray(spec.bbox) ? spec.bbox.map(tfPx) : [
      tfStyleNumber(source,"left"),
      tfStyleNumber(source,"top"),
      tfStyleNumber(source,"width"),
      tfStyleNumber(source,"height"),
    ];
    if(bbox.some(function(n){ return !Number.isFinite(n); })) return false;
    slot.style.left=bbox[0]+"px";
    slot.style.top=bbox[1]+"px";
    slot.style.width=bbox[2]+"px";
    slot.style.height=bbox[3]+"px";
    const clone=source.cloneNode(true);
    clone.removeAttribute("id");
    clone.style.position="absolute";
    clone.style.left="0px";
    clone.style.top="0px";
    clone.style.width=bbox[2]+"px";
    clone.style.height=bbox[3]+"px";
    slot.appendChild(clone);
    return true;
  }
  return false;
}
// Keep-slot stacking. Background / decorative / mask regions sit at the bottom
// so more specific chrome (status bar, title bar) and content keeps paint above
// them. Without this, a large background keep emitted later in the DOM would
// paint over and occlude the smaller status/title keeps it overlaps.
function tfKeepZIndexFor(anchor){
  if(/背景|装饰|遮罩|底图|蒙版|mask|overlay|backdrop|decorat|background/i.test(String(anchor||""))) return 0;
  return 1;
}
// True when box a geometrically CONTAINS box b (1px tolerance) and is strictly
// larger by area. Used to detect container keeps that wrap leaf keeps.
function tfBoxContains(a, b){
  if(!a||!b) return false;
  const ax=a[0],ay=a[1],aw=a[2],ah=a[3],bx=b[0],by=b[1],bw=b[2],bh=b[3];
  if(!(aw*ah>bw*bh)) return false;
  return ax-1<=bx && ay-1<=by && (ax+aw+1)>=(bx+bw) && (ay+ah+1)>=(by+bh);
}
// Build a per-layer keep z-index map from CONTAINMENT, not just names. A keep
// whose box wraps another keep's box is a container and must render BELOW the
// keep(s) it contains, so e.g. a 新闻内容区容器 that wraps the 导航标签栏 tab bar
// (both pinned at y=220) does not paint over and hide it. Backgrounds / masks
// stay at the bottom (0); leaf keeps sit on top (1); the card layer (z>=2) is
// reserved for regenerated update frames above all keeps.
function tfKeepZIndexMap(layer, registry){
  const slots=Array.prototype.slice.call(layer.querySelectorAll("[data-keep-anchor]"));
  const stateNumber=tfNum(layer.id);
  const boxes=slots.map(function(slot){
    const anchor=slot.getAttribute("data-keep-anchor");
    const bbox=tfLatestKeepBbox(anchor, stateNumber);
    return { anchor:anchor, bbox:bbox };
  });
  // Card-layer codegen update frames sit ABOVE the keep layer (z>=2) so they can
  // visually replace their kept ancestor container. But such a frame can also
  // geometrically CONTAIN a sibling keep that overlaps its top band — e.g. the
  // 新闻内容列表区 update frame (y=220) contains the 导航标签栏 tab bar (also
  // y=220). Without a counter-lift the opaque regenerated content paints over and
  // hides that keep. Collect those frames so a contained keep is lifted back on
  // top of them. Overlays / sheets (z>=40) are excluded — keeps stay below modals.
  const cardFrames=[];
  Array.prototype.slice.call(layer.querySelectorAll(".tf-component-frame[data-component-frame]")).forEach(function(fr){
    const z=parseInt((getComputedStyle(fr).zIndex||""),10);
    if(!isFinite(z)||z<=1||z>=40) return;
    const x=parseFloat(fr.style.left), y=parseFloat(fr.style.top),
          w=parseFloat(fr.style.width), h=parseFloat(fr.style.height);
    if([x,y,w,h].some(function(n){ return !isFinite(n); })) return;
    cardFrames.push({ z:z, bbox:[x,y,w,h] });
  });
  const map={};
  boxes.forEach(function(item){
    if(/背景|装饰|遮罩|底图|蒙版|mask|overlay|backdrop|decorat|background/i.test(String(item.anchor||""))){ map[item.anchor]=0; return; }
    let isContainer=false;
    if(item.bbox){
      for(const other of boxes){
        if(other===item||!other.bbox) continue;
        if(tfBoxContains(item.bbox, other.bbox)){ isContainer=true; break; }
      }
    }
    let z=isContainer?0:1;
    if(item.bbox){
      for(const cf of cardFrames){
        if(tfBoxContains(cf.bbox, item.bbox)) z=Math.max(z, cf.z+1);
      }
    }
    map[item.anchor]=z;
  });
  return map;
}
// Prune a full-page clone down to the spine from the clone root to target
// PLUS target's own subtree: at every level along that path, drop every element
// sibling that is not on the path. This keeps each positioned / flow ancestor
// intact (so the target's layout context — relative OR absolute — is preserved
// and we never hit the "absolutely-positioned child lost its positioned
// ancestor" problem), while deleting all unrelated branches so the keep can
// never reveal neighbouring base content.
function tfPruneToSpine(rootClone, target){
  let node=target;
  while(node && node!==rootClone){
    const parent=node.parentNode;
    if(!parent) break;
    let child=parent.firstChild;
    while(child){
      const next=child.nextSibling;
      if(child!==node && child.nodeType===1) parent.removeChild(child);
      child=next;
    }
    node=parent;
  }
}
function tfFillKeepPlaceholders(layer){
  if(!layer) return;
  const appRoot=document.getElementById("app-root");
  const registry=window.__TF_REGISTRY__ || {};
  const zmap=tfKeepZIndexMap(layer, registry);
  const zfor=function(a){ return Number.isFinite(zmap[a]) ? zmap[a] : tfKeepZIndexFor(a); };
  const stateNumber=tfNum(layer.id);
  layer.querySelectorAll("[data-keep-anchor]").forEach(function(slot){
    const anchor=slot.getAttribute("data-keep-anchor");
    const entry=registry[anchor] || {};
    slot.innerHTML="";
    slot.style.zIndex=String(zfor(anchor));
    // Slot geometry comes from the single newest-bbox resolver (ledgered move,
    // else registry bbox); no data-keep-override attribute round-trip.
    const slotBox=tfLatestKeepBbox(anchor, stateNumber);
    if(!appRoot){ tfFillVirtualKeep(slot, layer, anchor); slot.style.zIndex=String(zfor(anchor)); return; }
    // Clone the WHOLE page, then prune to the root->anchor spine (+ the anchor's
    // own subtree). The pruned clone keeps the anchor's full positioning context
    // so its inner layout is identical to the original, and every unrelated
    // branch is gone so nothing else can show through this keep window.
    const fullClone=appRoot.cloneNode(true);
    let target=null;
    if(entry.selector){ try{ target=fullClone.querySelector(entry.selector); }catch(e){} }
    if(!target && entry.id){ try{ target=fullClone.querySelector("#"+tfCssEscape(entry.id)); }catch(e){} }
    if(!target){ tfFillVirtualKeep(slot, layer, anchor); slot.style.zIndex=String(zfor(anchor)); return; }
    tfPruneToSpine(fullClone, target);
    if(slotBox){
      slot.style.left=slotBox[0]+"px";
      slot.style.top=slotBox[1]+"px";
      slot.style.width=slotBox[2]+"px";
      slot.style.height=slotBox[3]+"px";
    }
    const crop=document.createElement("div");
    crop.className="tf-keep-crop";
    crop.style.position="absolute";
    crop.style.left="0px";
    crop.style.top="0px";
    crop.style.width=(appRoot.offsetWidth||appRoot.scrollWidth||360)+"px";
    fullClone.style.position="static";
    fullClone.style.margin="0";
    crop.appendChild(fullClone);
    slot.appendChild(crop);
    // Shift the pruned clone so the anchor's OWN box lands at the slot origin.
    // Measured live (the layer is shown before keep fill), which works for both
    // flow and absolute layouts regardless of how pruning changed the flow.
    const tRect=target.getBoundingClientRect();
    const sRect=slot.getBoundingClientRect();
    if(tRect && sRect){
      crop.style.left=(sRect.left - tRect.left)+"px";
      crop.style.top=(sRect.top - tRect.top)+"px";
    }
  });
  // Region keep clones still hold the ORIGINAL pixels of updated cards. Once the
  // newest version of each updated card is mounted (its own slot / codegen / kept
  // slot), blank the stale original inside every OTHER clone so old content never
  // shows through. Folded in from the former standalone tfPunchUpdatedCards.
  const updated=tfUpdatedOriginalAnchors(stateNumber);
  if(updated.size){
    updated.forEach(function(anchor){
      const sel=String(anchor).replace(/"/g,'\\"');
      const fresh=layer.querySelector('[data-component-id="'+sel+'"],[data-keep-anchor="'+sel+'"]');
      if(!fresh) return;
      const entry=registry[anchor];
      if(!entry) return;
      layer.querySelectorAll("[data-keep-anchor]").forEach(function(other){
        if(other.getAttribute("data-keep-anchor")===anchor) return;
        let nodes=[];
        if(entry.selector){ try{ nodes=Array.prototype.slice.call(other.querySelectorAll(entry.selector)); }catch(e){} }
        if(!nodes.length&&entry.id){ try{ nodes=Array.prototype.slice.call(other.querySelectorAll("#"+tfCssEscape(entry.id))); }catch(e){} }
        nodes.forEach(function(node){ node.style.visibility="hidden"; });
      });
    });
  }
}
// Original anchors updated anywhere along this state's parent chain: their id
// now refers to the newest implementation, never the original pixels.
function tfUpdatedOriginalAnchors(stateNumber){
  const registry=window.__TF_REGISTRY__ || {};
  const set=new Set();
  const states=tfAncestorStates(stateNumber).slice();
  const current=tfStateById("state_"+stateNumber);
  if(current) states.push(current);
  states.forEach(function(state){
    ((state&&state.inheritance&&state.inheritance.update)||[]).forEach(function(patch){
      const id=patch&&(patch.id||patch.name);
      if(id&&registry[id]) set.add(id);
    });
  });
  return set;
}
function tfLatestUpdatePatchFor(stateNumber, anchor){
  const current=tfStateById("state_"+stateNumber);
  const states=[current].concat(tfAncestorStates(stateNumber));
  for(const state of states){
    const hit=((state&&state.inheritance&&state.inheritance.update)||[]).find(function(patch){
      return patch&&(patch.id||patch.name)===anchor;
    });
    if(hit) return hit;
  }
  return null;
}
function tfSelfBboxFromPatch(patch, anchor){
  if(!patch||typeof patch!=="object") return null;
  const mods=(Array.isArray(patch.modifications_applied)&&patch.modifications_applied.length
    ? patch.modifications_applied : patch.modifications)||[];
  for(const mod of mods){
    if(!mod||!Array.isArray(mod.set_bbox)||mod.set_bbox.length!==4) continue;
    const t=String(mod.target||"");
    const isSelfTarget=(!t||t==="self"||t==="bbox"||t===anchor||t==="children."+anchor);
    if(!isSelfTarget) continue;
    const bbox=mod.set_bbox.map(Number);
    if(bbox.length===4&&bbox.every(function(n){ return Number.isFinite(n); })) return bbox;
  }
  if(Array.isArray(patch.bbox)&&patch.bbox.length===4){
    const bbox=patch.bbox.map(Number);
    if(bbox.every(function(n){ return Number.isFinite(n); })) return bbox;
  }
  return null;
}
// Single source of truth for a kept original-DOM card's geometry in THIS state:
// the newest self set_bbox along the ancestor update chain (cumulative ledger),
// else the registry's original bbox. This replaces the old data-keep-override
// DOM round-trip — fill/z-index read this directly instead of an attribute that
// some other pass had to stamp first.
function tfLatestKeepBbox(anchor, stateNumber){
  const patch=tfLatestUpdatePatchFor(stateNumber, anchor);
  const fromLedger=patch?tfSelfBboxFromPatch(patch, anchor):null;
  if(fromLedger) return fromLedger;
  const registry=window.__TF_REGISTRY__||{};
  const entry=registry[anchor];
  if(entry&&Array.isArray(entry.bbox)&&entry.bbox.length===4){
    const b=entry.bbox.map(Number);
    if(b.every(function(n){ return Number.isFinite(n); })) return b;
  }
  return null;
}
// One runtime pass that guarantees every updated original-DOM card has a keep
// slot to render into for this state. It folds together three former patches:
//   * tfMountUpdatedOriginalCards — build a slot for THIS state's update patches;
//   * autoKeepUpdatedCards (state-model build time) — pull ancestor-updated cards
//     whose region is still kept, so a keep-only state shows the newest card;
//   * tfApplyKeepLedgerOverrides — newest bbox (now resolved lazily in fill via
//     tfLatestKeepBbox, so no data-keep-override attribute is written).
// Geometry is left to tfFillKeepPlaceholders/tfKeepZIndexMap → tfLatestKeepBbox.
function tfEnsureUpdatedKeepSlots(layer){
  if(!layer) return;
  const stateNumber=tfNum(layer.id);
  const updated=tfUpdatedOriginalAnchors(stateNumber);
  if(!updated.size) return;
  const state=tfStateById("state_"+stateNumber);
  const declaredHere=new Set();
  ((state&&state.inheritance&&state.inheritance.update)||[]).forEach(function(patch){
    const id=patch&&(patch.id||patch.name);
    if(id) declaredHere.add(id);
  });
  // Newest geometry of the slots already present, to test region containment for
  // ancestor-updated cards this state did not restate.
  const keepBoxes=[];
  layer.querySelectorAll("[data-keep-anchor]").forEach(function(slot){
    const box=tfLatestKeepBbox(slot.getAttribute("data-keep-anchor"), stateNumber);
    if(box) keepBoxes.push(box);
  });
  updated.forEach(function(anchor){
    const sel=String(anchor).replace(/"/g,'\\"');
    if(layer.querySelector('[data-component-id="'+sel+'"]')) return; // codegen version wins
    if(layer.querySelector('[data-keep-anchor="'+sel+'"]')) return; // slot already exists
    const box=tfLatestKeepBbox(anchor, stateNumber);
    if(!box) return;
    // An ancestor-updated card this state did not restate is only mounted when
    // its region is actually kept (its box sits inside a kept slot's box).
    if(!declaredHere.has(anchor) && !keepBoxes.some(function(kb){ return tfBoxContains(kb, box); })) return;
    const slot=document.createElement("div");
    slot.className="tf-keep-placeholder";
    slot.setAttribute("data-keep-anchor", anchor);
    slot.setAttribute("data-component-id", anchor);
    layer.appendChild(slot);
  });
}
// Apply a card's modification ledger inside its clone slot. Each state's patch
// carries the cumulative modifications list (every change since the original),
// so one application makes the slot the newest card — no ancestor replay.
// Supports set_text / set_text_style / set_props / set_bbox and a delete type
// (removes the targeted sub-node from the clone).
function tfApplyCardLedgers(layer){
  if(!layer) return;
  const registry=window.__TF_REGISTRY__ || {};
  const stateNumber=tfNum(layer.id);
  const updated=tfUpdatedOriginalAnchors(stateNumber);
  if(!updated.size) return;
  layer.querySelectorAll("[data-keep-anchor]").forEach(function(slot){
    const anchor=slot.getAttribute("data-keep-anchor");
    if(!updated.has(anchor)) return;
    const patch=tfLatestUpdatePatchFor(stateNumber, anchor);
    if(!patch) return;
    // Resolve the DOM node(s) inside this clone slot that a modification targets.
    // Targets may be: the anchor itself, a registry id, a "children.<id>" path,
    // or a raw original-DOM id. We try, in order: registry selector/id for the
    // raw target, then for the children-stripped id, then a direct "#id" lookup
    // inside the slot (original DOM children keep their id), then a
    // [data-component-id] / [data-tf-id] match. This is what lets a child
    // text/icon modification (e.g. "children.11_285136") actually hit its node.
    // Owner child id encoded by a canonical modification target. "children.<id>"
    // and "children.<id>.props.x" both own <id>; for nested paths the DEEPEST
    // "children.<id>" segment wins. A bare container field ("props.x"/"text"/
    // "bbox") owns nothing (null → the card root, handled by the caller).
    function ownerIdOf(target){
      const toks=String(target==null?"":target).split(".");
      let owner=null;
      for(var i=0;i<toks.length;i++){
        var tok=toks[i];
        if(tok==="children"&&i+1<toks.length){ owner=toks[i+1]; i++; continue; }
        if(/^(props|text|text_style|bbox|layout|self)$/i.test(tok)) break;
        owner=tok; // legacy bare id (no "children." prefix)
      }
      return owner;
    }
    function nodesFor(target){
      const owner=ownerIdOf(target);
      if(!owner) return [];
      const seen=new Set();
      const out=[];
      const push=function(list){ for(const n of list){ if(n&&!seen.has(n)){ seen.add(n); out.push(n); } } };
      const tryQuery=function(selector){
        if(!selector) return;
        try{ push(Array.prototype.slice.call(slot.querySelectorAll(selector))); }catch(e){}
      };
      const entry=registry[owner];
      if(entry&&entry.selector) tryQuery(entry.selector);
      if(entry&&entry.id) tryQuery("#"+tfCssEscape(entry.id));
      tryQuery("#"+tfCssEscape(owner));
      tryQuery('[data-component-id="'+owner.replace(/"/g,'\\"')+'"]');
      tryQuery('[data-tf-id="'+owner.replace(/"/g,'\\"')+'"]');
      return out;
    }
    const STYLE_KEYS={color:1,background:1,"background-color":1,backgroundColor:1,
      "font-size":1,fontSize:1,"font-weight":1,fontWeight:1,"font-style":1,fontStyle:1,
      "text-align":1,textAlign:1,"text-decoration":1,textDecoration:1,opacity:1,
      "border-color":1,borderColor:1,"border-radius":1,borderRadius:1,border:1,
      width:1,height:1,display:1,visibility:1,fill:1,stroke:1};
    const ATTR_KEYS={src:1,href:1,placeholder:1,alt:1,title:1,checked:1,selected:1,disabled:1};
    function applyProps(node, props){
      if(!props||typeof props!=="object") return;
      Object.keys(props).forEach(function(key){
        const val=props[key];
        if(val==null) return;
        const tag=(node.tagName||"").toLowerCase();
        if(key==="value"){
          if(tag==="input"||tag==="textarea"||tag==="select"){ node.value=val; node.setAttribute("value", val); }
          else node.textContent=val;
          return;
        }
        if(STYLE_KEYS[key]){ try{ node.style[key.replace(/-([a-z])/g,function(_,c){return c.toUpperCase();})]=val; }catch(e){} return; }
        if(ATTR_KEYS[key]){ try{ node.setAttribute(key, val); }catch(e){} return; }
        // data-*/aria-* are real attributes; set them as such. Any other unknown
        // key is ignored (previously it was dumped as an inline style, which
        // silently mis-applied business/semantic props as CSS).
        if(/^(data|aria)-/.test(key)){ try{ node.setAttribute(key, val); }catch(e){} }
      });
    }
    const mods=(Array.isArray(patch.modifications_applied)&&patch.modifications_applied.length
      ? patch.modifications_applied : patch.modifications)||[];
    mods.forEach(function(mod){
      if(!mod||typeof mod!=="object") return;
      const owner=ownerIdOf(mod.target);
      // A self/anchor target refers to the card root itself, realised by the SLOT
      // (tfFillKeepPlaceholders via tfLatestKeepBbox), so a self bbox is never
      // applied to the clone here (that would double-shift content).
      const isSelfTarget=(!owner||owner===anchor);
      if(String(mod.type||"")==="delete"){
        // Remove the deleted child node(s) from this clone. A self-target delete
        // would drop the card root (state-impl forbids deleting the top-level
        // parent), so skip it. For codegen cards the regenerated source already
        // omits the child, making this a harmless no-op.
        if(isSelfTarget) return;
        nodesFor(mod.target).forEach(function(node){ if(node&&node.parentNode) node.parentNode.removeChild(node); });
        return;
      }
      const hasText=typeof mod.set_text==="string";
      const style=mod.set_text_style&&typeof mod.set_text_style==="object"?mod.set_text_style:null;
      const props=mod.set_props&&typeof mod.set_props==="object"?mod.set_props:null;
      const bbox=Array.isArray(mod.set_bbox)&&mod.set_bbox.length===4?mod.set_bbox.map(Number):null;
      if(!hasText&&!style&&!props&&!bbox) return;
      let nodes=nodesFor(mod.target);
      if(!nodes.length&&isSelfTarget) nodes=nodesFor(anchor);
      nodes.forEach(function(node){
        if(hasText) node.textContent=mod.set_text;
        if(style) applyProps(node, style);
        if(props) applyProps(node, props);
        if(bbox&&!isSelfTarget){
          node.style.position=node.style.position||"absolute";
          node.style.left=bbox[0]+"px"; node.style.top=bbox[1]+"px";
          node.style.width=bbox[2]+"px"; node.style.height=bbox[3]+"px";
        }
      });
    });
  });
}
// Auto-transition delay (ms). Read from the trigger (delay_ms/delay/ms) first,
// then a model-level default (auto_transition_delay_ms), else 600. Replaces the
// previously hardcoded 600 literal so timing is data-driven, not baked in.
var TF_DEFAULT_AUTO_DELAY_MS=600;
function tfAutoDelayMs(source){
  const model=window.__TF_STATE_MODEL__ || {};
  const candidates=[source&&source.delay_ms, source&&source.delay, source&&source.ms, model.auto_transition_delay_ms];
  for(const c of candidates){
    const n=Number(c);
    if(Number.isFinite(n)&&n>=0) return n;
  }
  return TF_DEFAULT_AUTO_DELAY_MS;
}
function tfScheduleAutoTransition(currentState){
  const model=window.__TF_STATE_MODEL__ || {};
  // Outbound model: look for a "wait" trigger on the CURRENT state itself.
  const currentStateObj=(model.states||[]).find(function(s){ return tfNum(s.id)===currentState; });
  const waitTrig=currentStateObj && (currentStateObj.triggers||[]).find(function(t){
    return t && t.action==="wait";
  });
  if(waitTrig){
    const target=tfGotoTarget(waitTrig.goto);
    if(!target || target===currentState) return;
    window.clearTimeout(window.TF && window.TF._autoTimer);
    window.TF._autoTimer=window.setTimeout(function(){
      if(window.TF && window.TF.current===currentState) window.TF.goto(target);
    }, tfAutoDelayMs(waitTrig));
  }
}
function tfInstallGoto(){
  window.TF={current:1,goto:function(id){
    const n=Number(String(id).replace(/\\D/g,""))||1;
    const appRoot=document.getElementById("app-root");
    this.current=n;
    window.clearTimeout(this._autoTimer);
    document.querySelectorAll(".tf-state-layer").forEach(function(layer){layer.style.display="none";});
    if(n===1){
      // 回到初始态：恢复原始 D2C 页面
      if(appRoot) appRoot.style.display="";
      return;
    }
    // 非初始态：彻底隐藏初始页（state_1）。先临时恢复 app-root 让 keep 克隆/测量
    // 正常，填充后再隐藏；保留区与浮层背景都来自 keep 克隆，不依赖 app-root 可见。
    const layer=document.getElementById("tf-state-"+n);
    if(layer){
      if(appRoot) appRoot.style.display="";
      // Ensure every updated original-DOM card has a slot (folds in the old
      // mount/auto-keep/override passes), then fill keeps (geometry + stale-clone
      // hiding) and replay each card's modification ledger.
      tfEnsureUpdatedKeepSlots(layer);
      // Show the layer BEFORE filling keeps: tfFillKeepPlaceholders measures the
      // pruned clone live to align each anchor to its slot, which needs the slot
      // to be laid out (a display:none layer measures as 0).
      layer.style.display="block";
      tfFillKeepPlaceholders(layer);
      tfApplyCardLedgers(layer);
      if(appRoot) appRoot.style.display="none";
    }
    tfScheduleAutoTransition(n);
  }};
}
tfInstallGoto();
function tfGotoTarget(value){
  if(!value) return null;
  const match=String(value).match(/state[_-]?(\\d+)/i);
  return match?Number(match[1]):null;
}
function tfFindByDataAttr(root, attr, value){
  if(!root || !attr) return null;
  const nodes=root.querySelectorAll("["+attr+"]");
  const expected=String(value||"");
  for(const node of nodes){
    if(node.getAttribute(attr)===expected) return node;
  }
  return null;
}
function tfFindAllByDataAttr(root, attr, value){
  if(!root || !attr) return [];
  const expected=String(value||"");
  return Array.prototype.slice.call(root.querySelectorAll("["+attr+"]"))
    .filter(function(node){ return node.getAttribute(attr)===expected; });
}
function tfFindAnchorElements(anchor, stateNumber){
  const out=[];
  const seen=new Set();
  function add(el){
    if(!el || seen.has(el)) return;
    seen.add(el);
    out.push(el);
  }
  const raw=String(anchor||"");
  const escaped=tfCssEscape(raw);
  const registry=window.__TF_REGISTRY__ || {};
  const entry=registry[raw];
  const layer=stateNumber>1 ? document.getElementById("tf-state-"+stateNumber) : document.getElementById("app-root");
  // Prefer matches WITHIN the source state's own layer. A component that also
  // exists in other state sections (e.g. a BottomSheet created in one state and
  // updated in the next) must only receive THIS state's binding; searching the
  // whole document would bind every section's copy and let the last-installed
  // goto hijack earlier states (e.g. state_2 "下一步" jumping to state_4).
  if(layer){
    try{ add(layer.querySelector("#"+escaped)); }catch(e){}
    try{ tfFindAllByDataAttr(layer, "data-component-id", raw).forEach(add); }catch(e){}
    try{ tfFindAllByDataAttr(layer, "data-component-frame", raw).forEach(add); }catch(e){}
    try{ tfFindAllByDataAttr(layer, "data-keep-anchor", raw).forEach(add); }catch(e){}
  }
  if(out.length) return out;
  // Fallback only when the layer holds no match: registry selector / global
  // document (covers app-root anchors and anchors not present inside the layer).
  if(entry && entry.selector){ try{ add(document.querySelector(entry.selector)); }catch(e){} }
  if(entry && entry.id){ try{ add(document.getElementById(entry.id)); }catch(e){} }
  try{ add(document.querySelector("#"+escaped)); }catch(e){}
  try{ tfFindAllByDataAttr(document, "data-component-id", raw).forEach(add); }catch(e){}
  try{ tfFindAllByDataAttr(document, "data-component-frame", raw).forEach(add); }catch(e){}
  try{ tfFindAllByDataAttr(document, "data-keep-anchor", raw).forEach(add); }catch(e){}
  return out;
}
// Simplest "id + rule" target resolution:
//  - if target names a concrete child component / element id, bind that element;
//  - otherwise a couple of keyword rules pick primary/secondary button;
//  - otherwise bind the anchor element itself.
function tfPickTargetElements(root, target){
  if(!root) return [];
  const raw=target?String(target):"";
  if(raw){
    let el=null;
    try{ el=root.querySelector('[data-component-id="'+tfCssEscape(raw)+'"]'); }catch(e){}
    if(!el){ try{ el=root.querySelector('[data-component-frame="'+tfCssEscape(raw)+'"]'); }catch(e){} }
    if(!el){ try{ el=root.querySelector('#'+tfCssEscape(raw)); }catch(e){} }
    if(el) return [el];
    const text=raw.toLowerCase();
    const buttons=Array.prototype.slice.call(root.querySelectorAll("button,[role='button'],.tf-cg-confirm"));
    if(buttons.length){
      if(/secondary|cancel|back|close|取消|返回|关闭/.test(text)) return [buttons[0]];
      if(/primary|confirm|submit|主|保存|确认|确定/.test(text)) return [buttons[buttons.length-1]];
    }
  }
  return [root];
}
function tfPickTargetElement(root, target){
  return tfPickTargetElements(root, target)[0] || root;
}
function tfBindGoto(el, targetState){
  if(!el || !targetState) return;
  el.__tfGotoTarget=targetState;
  if(el.__tfGotoBound) return;
  el.__tfGotoBound=true;
  el.style.cursor="pointer";
  el.addEventListener("click",function(e){
    e.preventDefault();
    e.stopPropagation();
    window.TF.goto(el.__tfGotoTarget);
    });
  }
  function tfBindKeyboardReturnGoto(stateNumber, patch, targetState){
    const layer=document.getElementById("tf-state-"+stateNumber);
    if(!layer || !targetState) return;
    const keyboard=layer.querySelector(".tf-cg-keyboard,[data-component-id*='keyboard'],[data-component-id*='Keyboard']");
    if(!keyboard) return;
    const patchText=JSON.stringify(patch || {});
    if(!/保存|确定|提交|完成|save|submit|confirm|done/i.test(patchText)) return;
    const keys=Array.prototype.slice.call(layer.querySelectorAll(".tf-cg-kb-key-return"));
    if(!keys.length){
      // Generated keyboards do not always use the tf-cg-kb-key-return class;
      // fall back to the visible label of the return/confirm key.
      Array.prototype.slice.call(keyboard.querySelectorAll("button,div,span")).forEach(function(el){
        if(el.children.length) return;
        const label=String(el.textContent||"").trim();
        if(/^(完成|确定|保存|搜索|发送|前往|done|go|return|search|send|ok)$/i.test(label)) keys.push(el);
      });
    }
    keys.forEach(function(el){
      tfBindGoto(el, targetState);
    });
  }
  function tfInstallBindings(){
  const model=window.__TF_STATE_MODEL__ || {};
  function bindAnchorGoto(anchor, target, sourceState, targetState){
    if(!anchor || !targetState) return;
    const sourceNumber=tfNum(sourceState || 1);
    let roots=tfFindAnchorElements(anchor, sourceNumber);
    if(!roots.length){
      (window.__TF_STATE_MODEL__.states || []).forEach(function(item){
        const n=tfNum(item.id);
        if(n && n!==sourceNumber) roots=roots.concat(tfFindAnchorElements(anchor, n));
      });
    }
    roots.forEach(function(root){
      tfPickTargetElements(root, target).forEach(function(el){
        tfBindGoto(el, targetState);
      });
    });
  }
  (model.states||[]).forEach(function(state){
    const targetState=tfNum(state.id);
    // New outbound triggers model: each trigger is {action, anchor?, goto, target?}
    // living on the SOURCE state, pointing forward to goto.
    (state.triggers||[]).forEach(function(trig){
      if(!trig || trig.action==="wait") return; // "wait" handled by tfScheduleAutoTransition
      const gotoTarget=tfGotoTarget(trig.goto);
      if(!gotoTarget) return;
      bindAnchorGoto(trig.anchor, trig.target, state.id, gotoTarget);
      tfBindKeyboardReturnGoto(targetState, trig, gotoTarget);
    });
    const parentState=tfGotoTarget(state.parent_state);
    if(!parentState) return;
    ((state.inheritance&&state.inheritance.create)||[]).forEach(function(component){
      if(component.component!=="Overlay" && !/overlay|mask/i.test(String(component.id||""))) return;
      tfFindAnchorElements(component.id, targetState).forEach(function(root){
        tfBindGoto(root, parentState);
      });
    });
  });
}
tfInstallBindings();
window.__TF_LLM_READY__=true;
</script>
</body>
</html>`;
}

async function screenshotStates({ htmlPath, blueprint, model, outDir, width, height }) {
  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  const normalized = normalizeBlueprint(blueprint, model);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__TF_LLM_READY__ && window.TF && typeof window.TF.goto === "function", null, { timeout: 20000 });
  const shots = [];
  for (const state of normalized.states) {
    const shotHeight = heightForState(model, `state_${state.state_id}`, height);
    await page.setViewportSize({ width, height: shotHeight });
    await page.evaluate((n) => window.TF.goto(n), state.state_id);
    await page.waitForTimeout(400);
    const layerStatus = await page.evaluate((n) => {
      if (n === 1) return { exists: true, visible: true };
      const layer = document.getElementById("tf-state-" + n);
      return { exists: Boolean(layer), visible: Boolean(layer && window.getComputedStyle(layer).display !== "none") };
    }, state.state_id);
    const file = `state_${state.state_id}_force.png`;
    const target = path.join(outDir, file);
    await page.screenshot({ path: target, fullPage: false });
    const notBlank = fs.statSync(target).size > 1000;
    const shotIssues = [];
    if (!notBlank) shotIssues.push("blank screenshot");
    if (!layerStatus.exists) shotIssues.push("missing state layer");
    if (layerStatus.exists && !layerStatus.visible) shotIssues.push("state layer not visible");
    shots.push({ state_id: state.state_id, state_name: state.state_name, height: shotHeight, screenshot: file, not_blank: notBlank, layer_exists: layerStatus.exists, layer_visible: layerStatus.visible, status: shotIssues.length ? "fail" : "pass", issues: shotIssues });
  }
  await browser.close();
  const issues = shots.filter((shot) => shot.issues.length);
  const report = { html_path: rel(htmlPath), timestamp: new Date().toISOString(), shots, summary: { total_states: shots.length, force_pass: shots.filter((s) => s.status === "pass").length, issues_found: issues } };
  writeJson(path.join(outDir, "state_layers_report.json"), report);
  return report;
}

// Assemble the final `generated` layer object from the state model. Option A:
// the section skeleton is always rebuilt deterministically from the state model
// (the LLM never authors structure). `overrides` is an optional Map of measured
// per-state component heights (`${stateNum}::${id}` -> px) used for auto-fit.
function assembleGenerated(stateModel, componentCodegen, registry, baseNotes, overrides = null) {
  const ruleSkeleton = buildRuleGenerated(stateModel, componentCodegen, registry, overrides);
  const generated = {
    html: ruleSkeleton.html,
    css: ruleSkeleton.css,
    reactCode: "",
    validation_notes: [baseNotes, ruleSkeleton.validation_notes, "Runner rebuilt section skeleton from state model (Option A)."]
      .filter(Boolean)
      .join(" "),
  };
  if (overrides && overrides.size) {
    generated.validation_notes += ` Auto-fit shrank ${overrides.size} component height(s) from rendered content.`;
  }
  ensureStateSectionCoverage(generated, stateModel, componentCodegen, registry, overrides);
  ensureKeepPlaceholderCoverage(generated, stateModel, componentCodegen, registry);
  fillComponentPlaceholders(generated, stateModel, componentCodegen, registry, overrides);
  ensureComponentCodegenCoverage(generated, stateModel, componentCodegen, registry);
  normalizeComponentFrameCss(generated, stateModel, componentCodegen, registry, overrides);
  suppressUnexpectedBottomBars(generated, stateModel, componentCodegen);
  normalizeKeepPlaceholderCss(generated);
  return generated;
}

// Render the built page once and measure the natural content height of every
// ordinary, non-media fixed component. When the rendered content is meaningfully
// shorter than the authored bbox height, record an override so the next assembly
// pass shrinks the frame + component root and reflows downstream flow groups.
async function measureContentAutoFit(htmlPath, stateModel, componentCodegen, registry, width, height) {
  const overrides = new Map();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__TF_LLM_READY__ && window.TF && typeof window.TF.goto === "function", null, { timeout: 20000 });
    for (const state of stateModel.states || []) {
      const n = stateNum(state.id);
      if (n <= 1) continue;
      const candidates = [];
      for (const id of stateExpectedComponentIds(state, componentCodegen, registry)) {
        const spec = componentLayoutSpec(state, componentCodegen, id, registry);
        const bbox = Array.isArray(spec?.bbox) ? spec.bbox.map(Number) : null;
        if (!validBboxArray(bbox)) continue;
        if (isViewportFixedSpec(spec)) continue; // bottom bars / sheets / overlays keep authored size
        if (isMediaSpec(spec)) continue; // media keeps its intentional aspect height
        if (updateSetsExplicitBackground(state, registry, id)) continue; // explicit opaque background fill → authored bbox height is the intended display
        candidates.push({ id, declared: bbox[3] });
      }
      if (!candidates.length) continue;
      const shotHeight = heightForState(stateModel, `state_${n}`, height);
      await page.setViewportSize({ width, height: shotHeight });
      await page.evaluate((sid) => window.TF.goto(sid), n);
      await page.waitForTimeout(250);
      const measured = await page.evaluate(({ sid, ids }) => {
        const out = {};
        const layer = document.getElementById("tf-state-" + sid);
        if (!layer) return out;
        const esc = (window.CSS && CSS.escape) ? CSS.escape : (s) => s;
        for (const id of ids) {
          const root = layer.querySelector('[data-component-id="' + esc(id) + '"]');
          if (!root) continue;
          // A global rule forces `.tf-component-frame>[data-component-id]` to
          // height:100% !important, so the root always fills the frame. Override
          // it with an inline !important auto height to expose the real content
          // height for measurement.
          const prevCss = root.style.cssText;
          root.style.setProperty("height", "auto", "important");
          root.style.setProperty("max-height", "none", "important");
          void root.offsetHeight;
          const natural = Math.ceil(root.scrollHeight || root.getBoundingClientRect().height || 0);
          root.style.cssText = prevCss;
          out[id] = natural;
        }
        return out;
      }, { sid: n, ids: candidates.map((c) => c.id) });
      for (const c of candidates) {
        const natural = Number(measured[c.id]);
        if (!Number.isFinite(natural) || natural <= 0) continue;
        if (natural < c.declared - HEIGHT_FIT_TOLERANCE) overrides.set(`${n}::${c.id}`, natural);
      }
    }
  } finally {
    await browser.close();
  }
  return overrides;
}

async function main() {
  loadSkillEnv();
  configureNodePath();
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  const base = resolveArgPath(args[0] || ".", cwd);
  const modelName = resolveTextModel(argValue(args, "--model", ""));
  const htmlPath = resolveArgPath(
    argValue(args, "--html", path.join(base, ".run_skill/latest/preprocess/Index.preprocessed.html")),
    cwd,
  );
  const registryPath = resolveArgPath(
    argValue(args, "--registry", path.join(base, ".run_skill/latest/preprocess/semantic_registry.json")),
    cwd,
  );
  const stateModelPath = resolveArgPath(
    argValue(args, "--state-model", path.join(base, ".run_skill/latest/state_implementation/state_implementation_model.llm.json")),
    cwd,
  );
  const blueprintPath = resolveArgPath(argValue(args, "--blueprint", ""), cwd);
  const componentCodegenPath = resolveArgPath(argValue(args, "--component-codegen", ""), cwd);
  const outDir = resolveArgPath(
    argValue(args, "--out-dir", path.join(base, ".run_skill", "llm_layer_codegen")),
    cwd,
  );
  const outHtml = resolveArgPath(
    argValue(args, "--out-html", path.join(base, "html", "Index.state-model.llm-layers.html")),
    cwd,
  );
  const width = Number(argValue(args, "--width", "360"));
  const height = Number(argValue(args, "--height", "792"));
  if (Number.isFinite(width) && width > 0) TF_PAGE_WIDTH = width;
  const ruleOnly = !args.includes("--llm"); // default: rule-only layer; pass --llm to use LLM-authored layer
  const noAutoFit = !args.includes("--auto-fit"); // default: auto-fit OFF; pass --auto-fit to re-enable
  const maxTokens = Number(argValue(args, "--max-tokens", "12000"));

  const originalHtml = readUtf8(htmlPath);
  const registry = readJson(registryPath);
  const stateModel = readJson(stateModelPath);
  const blueprint = blueprintPath && exists(blueprintPath) ? readJson(blueprintPath) : null;
  const componentCodegen = componentCodegenPath && exists(componentCodegenPath) ? readJson(componentCodegenPath) : null;
  const promptInput = buildPromptInput({ registry, model: stateModel, blueprint, componentCodegen, width, height });
  writeJson(path.join(outDir, "llm_layer_input.json"), promptInput);

  let generated;
  let generationMode = "llm-placeholder";
  if (ruleOnly) {
    generated = buildRuleGenerated(stateModel, componentCodegen, registry);
    generationMode = "rule-only";
  } else {
    const skill = readUtf8(path.resolve(__dirname, "..", "SKILL.md"));
    try {
      const raw = await callLLM({
        model: modelName,
        system: `${skill}\n\nReturn JSON only. The JSON must contain placeholder HTML, not rendered component HTML.`,
        user: JSON.stringify(promptInput),
        maxTokens,
      });
      writeUtf8(path.join(outDir, "llm_layer.raw.txt"), raw);
      generated = extractJson(raw);
      const placeholderIssues = validatePlaceholderGenerated(generated, stateModel);
      if (placeholderIssues.length) {
        throw new Error(placeholderIssues.join("\n"));
      }
    } catch (err) {
      writeUtf8(path.join(outDir, "llm_layer.error.txt"), String(err.stack || err.message || err));
      generated = buildRuleGenerated(stateModel, componentCodegen, registry);
      generationMode = "rule-fallback";
    }
  }
  if (generationMode !== "llm-placeholder") {
    writeUtf8(path.join(outDir, "llm_layer.raw.txt"), JSON.stringify(generated));
  }
  // Option A: the state implementation model is the single source of truth for the
  // section skeleton. Any LLM-authored structure is advisory only and is discarded,
  // because flat string-splice injection on LLM HTML lands flow groups inside the
  // wrong parent frame (e.g. detail cards nested into the image carousel frame).
  const baseNotes = [generated.validation_notes, `generation_mode:${generationMode}`].filter(Boolean).join(" ");

  // Pass 1: assemble + render with authored heights so the runner can measure the
  // real content height of each component.
  let assembled = assembleGenerated(stateModel, componentCodegen, registry, baseNotes, null);
  let html = buildHtml({ originalHtml, registry, generated: assembled, stateModel, width, height });
  writeUtf8(outHtml, html);
  injectStateKeyNavIntoFile(outHtml);

  // Measurement-driven auto-fit: shrink over-tall content-driven components to
  // their rendered height and reflow downstream flow groups. Media/aspect
  // components (carousel, banner, ...) keep their authored bbox height.
  let heightOverrides = new Map();
  if (!noAutoFit) {
    try {
      heightOverrides = await measureContentAutoFit(outHtml, stateModel, componentCodegen, registry, width, height);
    } catch (err) {
      writeUtf8(path.join(outDir, "auto_fit.error.txt"), String(err.stack || err.message || err));
    }
  }
  writeJson(path.join(outDir, "auto_fit.overrides.json"), { tolerance_px: HEIGHT_FIT_TOLERANCE, overrides: Object.fromEntries(heightOverrides) });
  if (heightOverrides.size) {
    // Pass 2: re-assemble with measured heights, then re-render.
    assembled = assembleGenerated(stateModel, componentCodegen, registry, baseNotes, heightOverrides);
    html = buildHtml({ originalHtml, registry, generated: assembled, stateModel, width, height });
    writeUtf8(outHtml, html);
    injectStateKeyNavIntoFile(outHtml);
  }

  const generatedFinal = assembled;
  const issues = validateGenerated(generatedFinal, stateModel);
  writeJson(path.join(outDir, "llm_layer.generated.json"), generatedFinal);
  writeJson(path.join(outDir, "llm_layer.validation.json"), { issues });
  if (issues.length) {
    console.error("[llm-layer] validation issues:\n" + issues.join("\n"));
    process.exit(2);
  }
  // The path at --out-html is overwritten by every run; keep a timestamped
  // copy NEXT TO it (same directory) so relative asset paths keep resolving.
  // The stamp reuses the run directory's timestamp when present so the copy
  // correlates with its .run_skill/<ts> artifacts.
  const runStamp = (outDir.match(/(\d{14})/) || [])[1]
    || new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const archivedHtml = outHtml.replace(/\.html$/i, `.${runStamp}.html`);
  fs.copyFileSync(outHtml, archivedHtml);
  const shotsDir = path.join(outDir, "auto_shots");
  const shotReport = await screenshotStates({ htmlPath: outHtml, blueprint, model: stateModel, outDir: shotsDir, width, height });
  const ok = shotReport.summary.issues_found.length === 0;
  writeJson(path.join(outDir, "run_report.json"), { ok, generation_mode: generationMode, outputs: { html: rel(outHtml), html_archive: rel(archivedHtml), auto_shots: rel(shotsDir), state_layers_report: rel(path.join(shotsDir, "state_layers_report.json")) }, screenshot_summary: shotReport.summary });
  console.log(`[llm-layer] ok=${ok} out=${rel(outHtml)}`);
  if (!ok) process.exitCode = 2;
}

main().catch((err) => {
  console.error("[llm-layer] ERROR:", err.stack || err.message);
  process.exit(1);
});
