"use strict";

const fs = require("fs");
const path = require("path");
const { renderReactCode } = require("../../../scripts/react_ssr");
const {
  loadSkillEnv,
  configureNodePath,
  resolveArgPath,
  SKILL_ROOT,
  exists,
} = require("../../../../../scripts/paths");
const { callJsonChat, resolveTextModel } = require("../../../../../scripts/llm_config");

function readUtf8(file) { return fs.readFileSync(file, "utf8"); }
function readJson(file) { return JSON.parse(readUtf8(file).replace(/^\uFEFF/, "")); }
function writeUtf8(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, "utf8"); }
function writeJson(file, value) { writeUtf8(file, JSON.stringify(value, null, 2)); }
function argValue(args, name, fallback) { const idx = args.indexOf(name); return idx >= 0 ? args[idx + 1] : fallback; }
function rel(file) { return path.relative(process.cwd(), file).replace(/\\/g, "/"); }

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
  return callJsonChat({ model, system, user, maxTokens, label: "component-codegen" });
}

function componentText(component) {
  const visible = component.visible_text;
  if (typeof visible === "string") return visible;
  if (visible && typeof visible === "object") return Object.values(visible).flat().join(" ");
  if (Array.isArray(component.props?.sections)) {
    return component.props.sections.map((section) => section?.text || section?.caption || "").filter(Boolean).join("\n");
  }
  return component.text || component.description || "";
}

function fallbackComponent({ component, operation, originalComponent, generatedChildren = [], layoutContext = null }) {
  const id = component.id || component.name || "component";
  const bbox = Array.isArray(component.bbox) ? component.bbox : [0, 0, 120, 40];
  const kind = String(component.component || "component").toLowerCase();
  const text = componentText(component) || (operation === "update" && originalComponent?.text) || "";
  const hasBbox = Array.isArray(component.bbox);
  const rawWidth = component.props?.width || component.width || (layoutContext?.available_width ? "100%" : bbox[2]) || 120;
  const height = Number(component.props?.height || component.height || bbox[3] || 40);
  const style = hasBbox
    ? `position:absolute;left:${Number(bbox[0] || 0)}px;top:${Number(bbox[1] || 0)}px;width:${Number(bbox[2] || 0)}px;height:${Number(bbox[3] || 0)}px;`
    : `position:relative;width:${typeof rawWidth === "string" ? rawWidth : `${Number(rawWidth)}px`};max-width:100%;min-width:0;min-height:${height}px;`;
  const cls = kind.includes("button") ? "tf-cg-button" : kind.includes("input") ? "tf-cg-input" : kind.includes("toast") ? "tf-cg-toast" : "tf-cg-card";
  const childImports = generatedChildren.map((child) => `import ${child.importName} from ${JSON.stringify(child.importPath)};`);
  const childJsx = generatedChildren.map((child) => `        <${child.importName} />`).join("\n");
  const fallbackStyle = hasBbox
    ? `{ position: "absolute", left: ${Number(bbox[0] || 0)}, top: ${Number(bbox[1] || 0)}, width: ${Number(bbox[2] || 0)}, height: ${Number(bbox[3] || 0)} }`
    : `{ position: "relative", width: ${JSON.stringify(rawWidth)}, maxWidth: "100%", minWidth: 0, minHeight: ${height}, boxSizing: "border-box" }`;
  const reactCode = [
    "import React from \"react\";",
    ...childImports,
    "",
    "export default function GeneratedComponent() {",
    "  return (",
    `    <div data-component-id=${JSON.stringify(id)} className={${JSON.stringify(`tf-component ${cls}`)}} style={${fallbackStyle}}>`,
    childJsx || `      {${JSON.stringify(text)}}`,
    "    </div>",
    "  );",
    "}",
  ].join("\n");
  return {
    id,
    reactCode,
    html: `<div data-component-id="${id}" class="tf-component ${cls}" style="${style}">${text}</div>`,
    css: ".tf-cg-card{background:#fff;border:1px solid #f0f0f0;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:12px 16px;box-sizing:border-box;color:#1f1f1f}.tf-cg-button{display:flex;align-items:center;justify-content:center;border-radius:10px;background:#1677ff;color:#fff;font-weight:600;box-sizing:border-box}.tf-cg-input{display:flex;align-items:center;background:#fff;border:1px solid #f0f0f0;border-radius:12px;padding:0 14px;box-sizing:border-box;color:#999}.tf-cg-toast{display:flex;align-items:center;justify-content:center;border-radius:10px;background:rgba(0,0,0,.75);color:#fff;box-sizing:border-box}",
    notes: "fallback component",
  };
}

function validateComponent(parsed, id) {
  const issues = [];
  if (!parsed || typeof parsed !== "object") issues.push("response is not object");
  if (parsed.id && parsed.id !== id) issues.push(`id mismatch: expected ${id}, got ${parsed.id}`);
  if (typeof parsed.reactCode !== "string" || !parsed.reactCode.includes("export default")) issues.push("missing React default export");
  if (typeof parsed.reactCode === "string" && !parsed.reactCode.includes("data-component-id")) issues.push("React code missing data-component-id");
  if (typeof parsed.css !== "string") issues.push("missing css string");
  return issues;
}

function reactOnlyComponent(component) {
  if (!component) return null;
  return {
    id: component.id,
    reactCode: component.reactCode,
    notes: component.notes || "",
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function patchChildren(patch) {
  return Array.isArray(patch?.children) ? patch.children : [];
}

function findChildById(children, id) {
  for (const child of children || []) {
    if ((child?.id || child?.name) === id) return child;
    const nested = findChildById(patchChildren(child), id);
    if (nested) return nested;
  }
  return null;
}

// A `target` that begins with one of these tokens names a FIELD of the owning
// component (not a child whose id happens to equal the token). The owner is then
// given by `parent` / `target_component`.
const TF_SELF_FIELD_RE = /^(props|text|text_style|bbox|layout)(\.|\[|$)/i;

// Resolve which CHILD id (if any) a modification targets, or "" when it changes
// the container/owner itself. The state-model emits several equivalent shapes:
//   - "children.name_input" or a leading child id ("name_input.props.value")
//     -> the child is named directly in `target`;
//   - a field path ("props.disabled", "text", "bbox") -> the changed FIELD, whose
//     owner is `parent` (or `target_component`).
// Hardened so that (a) a child's prop change written as target "props.x" +
// parent "<childId>" routes to that child instead of being mistaken for a
// container self-change, and (b) a self/container field change (parent == the
// patch's own id) never hijacks a child that happens to share a reserved name
// like "props"/"text".
function modChildId(mod, children, patchId) {
  const rawTarget = String(mod?.target || "").trim();
  const targetComponent = String(mod?.target_component || "").trim();
  const ownerIsChild = (id) => Boolean(id) && id !== patchId && Boolean(findChildById(children, id));
  if (!rawTarget) {
    // No target: fall back to an explicit component-name owner if it is a child.
    return ownerIsChild(targetComponent) ? targetComponent : "";
  }
  // Canonical target carries the full ownership path ("children.<id>...",
  // "children.<id>.props.x", "props.x" for a container field). The leading
  // "children." plus the first segment names the owning direct child; a bare
  // container field ("props.x"/"text"/...) resolves to "" (the container).
  const target = rawTarget.replace(/^children\./, "");
  if (TF_SELF_FIELD_RE.test(target)) return "";
  const lead = target.split(/[.\[]/)[0].trim();
  if (lead && findChildById(children, lead)) return lead;
  if (ownerIsChild(targetComponent)) return targetComponent;
  return "";
}

// Like modChildId but resolves to the DIRECT (top-level) child id that owns the
// modification – even when the actual target is a grandchild. This is used when
// building the childMods routing table inside generateContainerUpdate so that
// "target: time_newest, parent: filter_time_section" maps to the direct child
// "filter_time_section" (not the recursively-found "time_newest").
function directOwnerChildId(mod, directChildren, parentId) {
  const rawTarget = String(mod?.target || "").trim();
  const targetComponent = String(mod?.target_component || "").trim();
  const isDirectChild = (id) => Boolean(id) && id !== parentId && Boolean(directChildren.find((c) => (c.id || c.name) === id));
  if (!rawTarget) {
    return isDirectChild(targetComponent) ? targetComponent : "";
  }
  const target = rawTarget.replace(/^children\./, "");
  if (TF_SELF_FIELD_RE.test(target)) return "";
  const lead = target.split(/[.\[]/)[0].trim();
  // Canonical path: the first segment after "children." is the direct child.
  if (lead && directChildren.find((c) => (c.id || c.name) === lead)) return lead;
  if (isDirectChild(targetComponent)) return targetComponent;
  // Last resort: find which direct child subtree contains the named descendant.
  if (lead) {
    for (const dc of directChildren) {
      if (findChildById(patchChildren(dc), lead)) return dc.id || dc.name || "";
    }
  }
  return "";
}

// Apply a container update patch's child-targeted modifications onto carried-
// forward child specs, using `set_props` / `set_text` / `set_text_style`. Used
// when an update patch does not re-state its `children` array (the SKILL treats
// unlisted parts as preserved), so the previous children are reused with only
// the listed changes. Supports arbitrarily nested paths: a target like
// "children.section_time.children.filter_time" correctly drills into
// section_time's children to update filter_time (3-level nesting).
function applyChildModifications(children, modifications, patchId) {
  for (const mod of Array.isArray(modifications) ? modifications : []) {
    const childId = modChildId(mod, children, patchId);
    if (!childId) continue;
    const child = findChildById(children, childId);
    if (!child) continue;

    // Detect whether the path continues deeper: after stripping the leading
    // "children." the remaining target may be "childId.children.deeperId".
    const rawTarget = String(mod?.target || "").trim();
    const normalized = rawTarget.replace(/^children\./, "");
    const deeperPrefix = childId + ".children.";
    if (normalized.startsWith(deeperPrefix)) {
      // Recurse into this child's children with the remaining path.
      const nestedTarget = normalized.slice(deeperPrefix.length);
      if (!Array.isArray(child.children)) child.children = [];
      applyChildModifications(child.children, [{ ...mod, target: nestedTarget }], childId);
      continue;
    }

    if (mod.set_props && typeof mod.set_props === "object" && !Array.isArray(mod.set_props)) {
      child.props = { ...(child.props || {}), ...mod.set_props };
    }
    if (typeof mod.set_text === "string") child.text = mod.set_text;
    if (mod.set_text_style && typeof mod.set_text_style === "object") child.text_style = mod.set_text_style;
  }
}

function safeName(name) {
  return String(name || "component").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function safeIdentifier(name, fallback) {
  const cleaned = String(name || fallback || "Child")
    .replace(/[^a-zA-Z0-9_$]/g, "_")
    .replace(/^[^a-zA-Z_$]/, "_$&");
  return cleaned || "Child";
}

function componentInputWithoutChildren(component, children) {
  const next = cloneJson(component);
  delete next.children;
  if (children.length) next.__hasChildren = true;
  return next;
}

// Keep in sync with page-layer/scripts/run_skill.js updateNeedsCodegen.
function patchModifications(patch) {
  return [
    ...(Array.isArray(patch?.modifications_applied) ? patch.modifications_applied : []),
    ...(Array.isArray(patch?.modifications) ? patch.modifications : []),
  ];
}

// Keep in sync with page-layer/scripts/run_skill.js originalAnchorUpdateNeedsCodegen.
const ORIGINAL_ANCHOR_SIMPLE_PROP_KEYS = /^(color|opacity|visibility|display|fontSize|fontWeight|fontStyle|backgroundColor|layoutRole|zIndex|clearable|checked|selected)$/i;

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

function isOriginalAnchorId(id, registry, createdIds) {
  return Boolean(id && registry?.semantic_dom_registry?.[id] && !createdIds.has(id));
}

function updatePatchNeedsCodegen(patch, registry, createdIds) {
  const id = patch?.id || patch?.name;
  if (isOriginalAnchorId(id, registry, createdIds)) return originalAnchorUpdateNeedsCodegen(patch);
  return updateNeedsCodegen(patch);
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

// Original-anchor updates often carry business props only inside modifications
// (not top-level patch.props). Promote them so the LLM receives a full spec.
function enrichOriginalAnchorPatch(patch) {
  if (!patch || typeof patch !== "object") return patch;
  const next = cloneJson(patch);
  const props = { ...(next.props || {}) };
  for (const mod of patchModifications(patch)) {
    if (mod?.set_props && typeof mod.set_props === "object" && !Array.isArray(mod.set_props)) {
      Object.assign(props, mod.set_props);
    }
  }
  if (Object.keys(props).length) next.props = props;
  return next;
}

function childImportMeta(record, child, index) {
  const id = componentRecordId(record) || child?.id || child?.name || `child_${index + 1}`;
  return {
    id,
    component: child?.component || null,
    importName: safeIdentifier(`Child_${safeName(id)}`, `Child${index + 1}`),
    importPath: `./${safeName(id)}`,
    props: child?.props || {},
    text: child?.text || child?.visible_text || null,
    description: child?.description || null,
    layout_context: record?.input?.layout_context || null,
  };
}

function componentName(component) {
  return String(component?.component || "").trim();
}

function componentRecordId(record) {
  return record?.component?.id || record?.input?.component?.id || record?.input?.component?.name || "";
}

function componentSourceCandidates(componentsDir, name) {
  const lower = String(name || "").toLowerCase();
  const direct = path.join(componentsDir, name, "index.tsx");
  const candidates = [];
  if (exists(direct)) candidates.push(direct);
  if (lower === "capsulebutton" || lower === "textbutton") candidates.push(path.join(componentsDir, "ui", "Button", "index.tsx"));
  if (lower === "buttonbar") candidates.push(path.join(componentsDir, "ButtonBar", "index.tsx"), path.join(componentsDir, "ui", "Button", "index.tsx"));
  if (lower === "sectionlayout") candidates.push(path.join(componentsDir, "SectionLayout", "index.tsx"), path.join(componentsDir, "SectionTitle", "index.tsx"), path.join(componentsDir, "UnderlineTabs", "index.tsx"), path.join(componentsDir, "MoreButton", "index.tsx"));
  if (lower === "productlayout") candidates.push(path.join(componentsDir, "ProductLayout", "index.tsx"), path.join(componentsDir, "LeftSidebar", "index.tsx"), path.join(componentsDir, "FilterPills", "index.tsx"), path.join(componentsDir, "ProductCard", "index.tsx"));
  return [...new Set(candidates)].filter(exists);
}

function componentReadmeSection(readme, name) {
  if (!readme || !name) return "";
  const aliases = {
    capsulebutton: "CapsuleButton",
    textbutton: "TextButton",
  };
  const title = aliases[String(name).toLowerCase()] || name;
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`((?:^|\\n)###\\s+\`${escaped}\`[\\s\\S]*?)(?=\\n###\\s+\`|\\n##\\s+|$)`);
  const match = readme.match(re);
  return match ? match[1].trim() : "";
}

function buildComponentLibSection({ resourcesDir, componentsDir, component }) {
  const globalCssPath = path.join(resourcesDir, "global.css");
  const readmePath = path.join(componentsDir, "README.md");
  const name = componentName(component);
  const sections = [];
  if (exists(globalCssPath)) {
    const cssVars = readUtf8(globalCssPath)
      .replace(/@import[^\n]+\n/g, "")
      .replace(/@tailwind[^\n]+\n/g, "");
    sections.push([
      "\n\n## Design System CSS Variables",
      "Use these CSS custom properties and static-safe utility classes in your output.",
      "```css",
      cssVars.trim(),
      "```",
    ].join("\n"));
  }
  if (exists(readmePath)) {
    const readme = readUtf8(readmePath);
    const section = componentReadmeSection(readme, name);
    if (section) {
      sections.push(["\n\n## Component Reference", section].join("\n"));
    }
  }
  const sourceFiles = componentSourceCandidates(componentsDir, name);
  if (sourceFiles.length) {
    sections.push([
      "\n\n## Relevant Component Source",
      "Use these as actual React component building blocks and follow their documented props.",
      "```tsx",
      sourceFiles.map((file) => `// ${path.relative(componentsDir, file)}\n${readUtf8(file)}`).join("\n\n---\n\n"),
      "```",
    ].join("\n"));
  } else {
    sections.push([
      "\n\n## Component Reference",
      `No documented component source was found for component "${name}". Generate a custom component only if no documented component fits.`,
    ].join("\n"));
  }
  return sections.join("\n");
}

function validBboxArray(value) {
  return Array.isArray(value) && value.length === 4 && value.every((item) => Number.isFinite(Number(item)));
}

function inferSlot(child) {
  const haystack = [
    child?.id,
    child?.name,
    child?.component,
    child?.props?.slot,
    child?.props?.role,
    child?.layout?.slot,
    child?.mount,
  ].filter(Boolean).join("_").toLowerCase();
  if (/footer|action|button[_-]?bar|bottom[_-]?bar|submit|confirm/.test(haystack)) return "footer";
  if (/header|title|nav/.test(haystack)) return "header";
  if (/body|content|main/.test(haystack)) return "body";
  return "content";
}

function isContainerComponent(component) {
  return /container|layout|panel|section|wrapper|root|shell|dialog|modal|bottomsheet|bottom_sheet|drawer|popup/i.test(String(component?.component || ""));
}

function isPaddedFloatingContainer(component) {
  return /dialog|modal|bottomsheet|bottom_sheet|drawer|popup/i.test(String(component?.component || ""));
}

function layoutPaddingFor(parent, slot) {
  if (!isPaddedFloatingContainer(parent)) return 0;
  // Floating surfaces in the reference library use compact horizontal padding;
  // this is only a codegen hint, not page-layer geometry.
  if (slot === "footer" || slot === "body" || slot === "content") return 32;
  return 0;
}

function childLayoutContext({ parent, child, parentLayoutContext = null }) {
  if (!parent || !isContainerComponent(parent)) return null;
  const slot = inferSlot(child);
  const parentBbox = validBboxArray(parent.bbox) ? parent.bbox.map(Number) : null;
  const childBbox = validBboxArray(child?.bbox) ? child.bbox.map(Number) : null;
  const padding = layoutPaddingFor(parent, slot);
  const inheritedWidth = Number(parentLayoutContext?.available_width || parentLayoutContext?.parent_available_width || 0);
  const inheritedHeight = Number(parentLayoutContext?.available_height || parentLayoutContext?.parent_available_height || 0);
  const parentWidth = parentBbox ? parentBbox[2] : inheritedWidth || null;
  const parentHeight = parentBbox ? parentBbox[3] : inheritedHeight || null;
  const availableWidth = childBbox ? childBbox[2] : parentWidth ? Math.max(0, parentWidth - padding) : null;
  const availableHeight = childBbox ? childBbox[3] : parentHeight || null;
  return {
    parent_id: parent.id || parent.name || null,
    parent_component: parent.component || null,
    parent_bbox: parentBbox,
    parent_available_width: parentWidth,
    parent_available_height: parentHeight,
    slot,
    available_width: availableWidth,
    available_height: availableHeight,
    child_has_bbox: Boolean(childBbox),
    child_should_fill_parent: !childBbox,
  };
}

function applyLayoutDefaults(component, layoutContext, isTopLevel) {
  const next = cloneJson(component);
  if (!layoutContext || isTopLevel) return next;
  const props = next.props && typeof next.props === "object" && !Array.isArray(next.props) ? { ...next.props } : {};
  const hasExplicitWidth = props.width != null || next.width != null || validBboxArray(next.bbox);
  if (!hasExplicitWidth && layoutContext.child_should_fill_parent) {
    next.props = props;
    props.width = "100%";
  }
  return next;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function runNext() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runNext);
  await Promise.all(workers);
  return results;
}

// Global concurrency gate shared across the whole component-codegen run. Every
// expensive unit of work (one component's LLM call + React SSR render) acquires
// a slot here, so we can parallelize sibling children freely WITHOUT the total
// number of in-flight LLM calls ever exceeding `max` (avoids provider rate
// limits even for deep/wide component trees). A parent never holds a slot while
// awaiting its children, so this cannot deadlock.
function createLimiter(max) {
  const size = Math.max(1, Number(max) || 1);
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < size && queue.length) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; pump(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}

async function renderComponentRecord(parsed, { id, outDir }) {
  const rendered = await renderReactCode({
    id,
    reactCode: parsed.reactCode,
    css: parsed.css || "",
    outDir,
  });
  return {
    ...parsed,
    html: rendered.html,
    css: rendered.css,
    render: {
      mode: "react-ssr",
      source_file: rel(rendered.sourceFile),
      bundle_file: rel(rendered.bundleFile),
    },
  };
}

function mergeChildCss(parsed, childRecords) {
  const childCss = childRecords
    .map((record) => record?.component?.css)
    .filter((css) => typeof css === "string" && css.trim());
  if (!childCss.length) return parsed;
  return {
    ...parsed,
    css: [parsed.css || "", ...childCss].filter(Boolean).join("\n\n"),
  };
}

// Two independently-generated components routinely reuse the same authored
// class names (e.g. three `AppCard`/`MeetingItem` siblings all emit
// `.tf-cg-app-card-content`). page-layer only scopes the merged component CSS
// to the owning state (`#tf-state-N`), so identical class rules from sibling
// components — whether siblings are separate top-level placeholders or sibling
// CHILDREN inside one container — collide and overwrite each other.
//
// To make each component's authored CSS self-contained, namespace its OWN css
// by the component's `data-component-id` BEFORE it is merged upward into a
// parent (children render first and arrive here already scoped). The rendered
// HTML is untouched: every component root already carries `data-component-id`,
// so its inner elements are naturally that attribute's descendants. The
// design-system / global CSS (added later by the renderer) is NOT scoped here.
function cssAttrValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function matchCssBraceEnd(css, openIndex) {
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

// Emit both a compound form (`[attr].sel`, matches the component root element
// itself) and a descendant form (`[attr] .sel`, matches inner elements). The
// compound form is only valid when the selector starts with a class/id/attr/
// pseudo token, never a bare tag (`[attr]div` is invalid CSS).
function scopeSelectorToComponent(single, attr) {
  const s = single.trim();
  if (!s) return [];
  if (/^(html|body|:root)\b/i.test(s)) return [s];
  const out = [`${attr} ${s}`];
  const first = s[0];
  if (first === "." || first === "#" || first === "[" || first === ":" || first === "&") {
    out.unshift(`${attr}${s}`);
  }
  return out;
}

function scopeCssBlockToComponent(css, attr) {
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
      const end = matchCssBraceEnd(css, brace);
      if (/^@(media|supports)\b/i.test(trimmed)) {
        out += `${selector}{${scopeCssBlockToComponent(css.slice(brace + 1, end), attr)}}`;
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
      .flatMap((sel) => scopeSelectorToComponent(sel, attr))
      .filter(Boolean)
      .join(",");
    out += `${scoped}{${css.slice(brace + 1, end)}}`;
    index = end + 1;
  }
  return out;
}

function scopeOwnCssByComponentId(css, componentId) {
  const id = String(componentId || "").trim();
  const source = String(css || "");
  if (!id || !source.trim()) return source;
  return scopeCssBlockToComponent(source, `[data-component-id="${cssAttrValue(id)}"]`);
}

// Return a shallow clone of a parsed component whose OWN css is namespaced to
// its component id, ready to be passed into mergeChildCss/renderComponentRecord.
// The caller keeps the unscoped `ownCss` separately so constrained updates can
// re-merge the previous authored css without double-scoping.
function scopeParsedOwnCss(parsed, id) {
  if (!parsed || typeof parsed.css !== "string" || !parsed.css.trim()) return parsed;
  return { ...parsed, css: scopeOwnCssByComponentId(parsed.css, id) };
}

async function generateComponentRecord({ component, operation, originalComponent, originalReference, generatedChildren, childRecords, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, isTopLevel, layoutContext, updateInstruction = "" }) {
  const componentForInput = applyLayoutDefaults(component, layoutContext, isTopLevel);
  const id = componentForInput.id || componentForInput.name;
  const input = operation === "update"
    ? { operation, viewport, state_context: stateContext, component: componentForInput, generated_children: generatedChildren || [], original_component: reactOnlyComponent(originalComponent), original_reference: originalReference || null, update_instruction: updateInstruction || null, is_top_level: Boolean(isTopLevel), layout_context: layoutContext || null }
    : { operation, viewport, state_context: stateContext, component: componentForInput, generated_children: generatedChildren || [], is_top_level: Boolean(isTopLevel), layout_context: layoutContext || null };
  let parsed;
  let raw = "";
  let issues = [];
  if (useFallback) {
    parsed = fallbackComponent({ component: componentForInput, operation, originalComponent, generatedChildren, layoutContext });
  } else {
    // A constrained update must preserve the previous version's styling and only
    // apply the described change, so the same component does not drift in look
    // between states.
    const constraint = updateInstruction
      ? `\n\nThis is a CONSTRAINED UPDATE. "original_component.reactCode" is the previous version of THIS component. Start from it and reproduce it EXACTLY, changing ONLY what this change requires: ${updateInstruction}. Keep every class name, DOM structure, layout, spacing, color, radius and all unrelated text/props byte-for-byte identical to original_component. Do NOT restyle, re-layout, rename classes, or regenerate from scratch.`
      : "";
    const fillChildRowConstraint = "\n\nLAYOUT CONSTRAINT (fill-width children): any imported child in `generated_children` whose `layout_context.child_should_fill_parent` is true renders with `width:100%` and fills the parent content width. NEVER place two or more such fill-width children side-by-side in a horizontal flex row (a `display:flex` / `flex-direction:row` line with multiple child siblings): their `width:100%` bases add up to more than the row, so a `flex:1` sibling collapses to ~0 width and its text wraps one character per line (vertical text). Stack fill-width children VERTICALLY (one per line, e.g. `flex-direction:column`). If the design truly needs a label and a compact badge/status on the SAME line, do not place two raw fill-width children in that row: render the compact inline content yourself, or wrap each child in an explicit flex item that overrides the width (the flexible one `flex:1 1 0;min-width:0`, the compact one `flex:0 0 auto` with `width:auto`).";
    const systemPrompt = [
      skill,
      buildComponentLibSection({ resourcesDir, componentsDir, component }),
      fillChildRowConstraint,
      constraint,
      `\n\nIn the "notes" field, list which component reference/source and CSS variables you used (e.g. "used ${componentName(component)}, --color-primary, --radius-md"). Return JSON only.`,
    ].join("");
    raw = await callLLM({ model: modelName, system: systemPrompt, user: JSON.stringify(input), maxTokens });
    parsed = extractJson(raw);
  }
  // The component's OWN css (LLM/fallback authored, before design-system and
  // child css are merged in by the renderer). Recorded so a later state can
  // re-stitch the component as `ownCss + current children css` without
  // re-accumulating design-system/child css on every update.
  let ownCss = parsed && typeof parsed.css === "string" ? parsed.css : "";
  // A constrained UPDATE only tweaks reactCode (markup / props / inline styles);
  // the component's OWN structural css is largely stable between states. The LLM,
  // however, regenerates css every call and frequently DROPS class rules it still
  // references (e.g. a BottomSheet keeps .tf-cg-sheet-header in its markup but
  // emits no rule for it, collapsing the header to inline flow). To make per-state
  // css survive without page-layer band-aids, MERGE the previous version's ownCss
  // with the freshly generated one: previous rules go first so any rule the LLM
  // dropped is restored, and the LLM's rules go last so legitimate style changes
  // (and css for newly added children/elements) still win by cascade order on
  // overlapping selectors. This is the source-of-truth fix.
  if (operation === "update"
    && originalComponent
    && typeof originalComponent.ownCss === "string"
    && originalComponent.ownCss.trim()) {
    const prevOwnCss = originalComponent.ownCss.trim();
    const llmOwnCss = (ownCss || "").trim();
    ownCss = (!llmOwnCss || llmOwnCss === prevOwnCss)
      ? prevOwnCss
      : `${prevOwnCss}\n\n${llmOwnCss}`;
    if (parsed && typeof parsed === "object") parsed.css = ownCss;
  }
  parsed = mergeChildCss(scopeParsedOwnCss(parsed, id), childRecords || []);
  issues = validateComponent(parsed, id);
  if (issues.length) {
    const fb = fallbackComponent({ component: componentForInput, operation, originalComponent, generatedChildren, layoutContext });
    ownCss = fb.css || "";
    parsed = mergeChildCss(scopeParsedOwnCss(fb, id), childRecords || []);
  }
  try {
    parsed = await renderComponentRecord(parsed, { id, outDir });
  } catch (err) {
    issues.push("react render failed: " + err.message);
    const fb = fallbackComponent({ component: componentForInput, operation, originalComponent, generatedChildren, layoutContext });
    ownCss = fb.css || "";
    parsed = await renderComponentRecord(mergeChildCss(scopeParsedOwnCss(fb, id), childRecords || []), { id, outDir });
  }
  if (parsed && typeof parsed === "object") parsed.ownCss = ownCss;
  // Carry the resolved layout (group/startAnchor/spacing) onto the OUTPUT
  // component so a later state that reuses this component can inherit it even
  // when its own update patch omits layout. Falls back to the previous
  // version's stamped layout when this spec has none.
  if (parsed && typeof parsed === "object") {
    const carriedLayout = (componentForInput && componentForInput.layout) || (originalComponent && originalComponent.__layout) || null;
    if (carriedLayout) parsed.__layout = carriedLayout;
  }
  if (raw) writeUtf8(path.join(rawDir, `${stateContext.id}_${operation}_${id}.raw.txt`), raw);
  return { state_id: stateContext.id, operation, original_component_id: originalComponent?.id || null, component: parsed, input, issues };
}

// Re-render a previously generated component from its OWN React source without
// any LLM call, so a child/parent that did not change keeps byte-identical
// styling across states. The source file is rewritten to outDir so a parent that
// imports it (by id) picks up the same code, and child CSS is re-merged so the
// container's CSS still includes its children.
async function reuseComponentRecord({ prevComponent, id, stateContext, outDir, childRecords = [], operation = "reuse", componentSpec = null }) {
  // Rebuild from the component's OWN css plus the CURRENT children css, so the
  // renderer re-adds the design system exactly once and we never accumulate
  // duplicate design-system/child css across successive updates. Fall back to
  // the stored merged css only for older records that predate ownCss.
  const ownCss = typeof prevComponent.ownCss === "string" ? prevComponent.ownCss : (prevComponent.css || "");
  let parsed = {
    id,
    reactCode: prevComponent.reactCode,
    css: ownCss,
    notes: prevComponent.notes || "reused from previous state",
  };
  parsed = mergeChildCss(scopeParsedOwnCss(parsed, id), childRecords || []);
  let issues = [];
  try {
    parsed = await renderComponentRecord(parsed, { id, outDir });
  } catch (err) {
    issues = ["reuse render failed: " + err.message];
  }
  if (parsed && typeof parsed === "object") parsed.ownCss = ownCss;
  // Preserve the component's spec (layout/group/startAnchor) on the reuse
  // record's input.component. A reuse record used to drop input.component
  // entirely, which lost the layout metadata and made a later state that KEEPs
  // this component render it unpositioned (it collapsed to the top of the
  // layer). Inherit the previous version's stamped layout when the current
  // spec omits it.
  const prevLayout = prevComponent && prevComponent.__layout ? prevComponent.__layout : null;
  let specForInput = componentSpec ? cloneJson(componentSpec) : null;
  if (specForInput && !specForInput.layout && prevLayout) specForInput.layout = prevLayout;
  if (!specForInput && prevLayout) specForInput = { id, layout: prevLayout };
  const carriedLayout = (specForInput && specForInput.layout) || prevLayout || null;
  if (parsed && typeof parsed === "object" && carriedLayout) parsed.__layout = carriedLayout;
  const input = specForInput
    ? { operation, reused_from: id, component: specForInput }
    : { operation, reused_from: id };
  return { state_id: stateContext.id, operation, original_component_id: id, component: parsed, input, issues };
}

// Surgical container update implementing inheritance-preserving update:
//  1. children NOT touched by any modification are reused verbatim;
//  2. children targeted by a modification are regenerated FROM their previous
//     React code under a strict "only change <change>" constraint;
//  3. the parent shell is regenerated (from its previous React code + new child
//     imports + spec, constrained) when a modification targets the container
//     itself OR a NEW child was added (modification type "create" / a child with
//     no previous render), so the new child is inserted into the parent;
//     otherwise the previous parent code is re-rendered as-is so it re-imports
//     the now-updated child sources.
// This keeps the look of unchanged parts identical between states instead of
// re-authoring every component from scratch on each update.
async function generateContainerUpdate({ patch, children, depth, generatedById, lastChildrenById, registry, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, limit, layoutContext }) {
  const parentId = patch.id || patch.name;
  const prevParent = generatedById[parentId];
  const allRecords = [];
  const mods = Array.isArray(patch.modifications) ? patch.modifications : [];

  // A `delete` modification removes a child component. When it targets a DIRECT
  // child of this container, that child is dropped entirely and the shell is
  // regenerated WITHOUT it (its import/markup must disappear) — the same "must
  // regenerate the parent" mechanism used for new children. A delete that
  // targets a grandchild keeps the direct child and recurses as a nested delete
  // on it (handled via the childMods routing below, like any nested mod).
  const isDeleteType = (mod) => String(mod?.type || "").toLowerCase() === "delete";
  const directDeleteIds = new Set();
  for (const mod of mods) {
    if (!isDeleteType(mod)) continue;
    const directId = directOwnerChildId(mod, children, parentId);
    const deepId = modChildId(mod, children, parentId);
    if (directId && directId === deepId) directDeleteIds.add(directId);
  }
  if (directDeleteIds.size) {
    children = children.filter((c) => !directDeleteIds.has(c.id || c.name));
  }

  // Use directOwnerChildId (not modChildId) so that deep-targeting mods like
  // "target: time_newest, parent: filter_time_section" are keyed by the DIRECT
  // child "filter_time_section" rather than by the recursively-found grandchild
  // "time_newest". This ensures the direct child is correctly identified as
  // modified and receives its nested modifications via the update path.
  const childMods = new Map();
  for (const mod of mods) {
    const cid = directOwnerChildId(mod, children, parentId);
    if (cid) {
      const arr = childMods.get(cid) || [];
      arr.push(mod);
      childMods.set(cid, arr);
    }
  }
  // New child detection. A modification with type "create" declares a brand-new
  // child (only a previously-rendered child may be "update"d). We also treat any
  // child in this update that has no previous render as new. A new child means
  // the parent shell MUST be regenerated to insert it — re-rendering the old
  // parent code as-is would silently drop it (its import/markup never existed).
  const isCreateType = (mod) => String(mod?.type || "").toLowerCase() === "create";
  const createModTargets = new Set(
    mods.filter(isCreateType).map((mod) => modChildId(mod, children, parentId)).filter(Boolean)
  );
  const newChildIds = new Set();
  for (const child of children) {
    const cid = child.id || child.name;
    if (!cid) continue;
    const prev = generatedById[cid];
    if (createModTargets.has(cid) || !prev || !prev.reactCode) newChildIds.add(cid);
  }
  const changeTextFor = (modList) => modList
    .map((m) => m.change || (m.set_props ? `set props ${JSON.stringify(m.set_props)}` : "") || (typeof m.set_text === "string" ? `set text "${m.set_text}"` : ""))
    .filter(Boolean)
    .join("; ");

  const shared = { depth: depth + 1, generatedById, lastChildrenById, registry, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, limit };
  const childResults = await Promise.all(children.map((child) => {
    const childId = child.id || child.name;
    const prevChild = childId ? generatedById[childId] : null;
    const cLayout = childLayoutContext({ parent: patch, child, parentLayoutContext: layoutContext });
    // A child that is itself a container with its own children: defer to the
    // normal recursive path. If this child also has modifications targeting its
    // own sub-children, convert them into nested modifications on the child patch
    // and recurse as an "update" so the instruction is propagated correctly.
    if (patchChildren(child).length) {
      let childPatch = child;
      let childOp = child.type === "update" ? "update" : "create";
      if (childMods.has(childId)) {
        const nestedMods = (childMods.get(childId) || []).map((m) => {
          const rawT = String(m?.target || "").replace(/^children\./, "");
          const stripPrefix = childId + ".";
          const nestedT = rawT.startsWith(stripPrefix) ? rawT.slice(stripPrefix.length) : rawT;
          return { ...m, target: nestedT };
        });
        childPatch = { ...child, modifications: nestedMods, type: "update" };
        childOp = "update";
      }
      return generatePatchTree({ patch: childPatch, operation: childOp, ...shared, layoutContext: cLayout })
        .then((res) => ({ record: res.record, allRecords: res.allRecords }));
    }
    if (!prevChild || !prevChild.reactCode) {
      // No previous version to inherit from: create it fresh.
      return limit(() => generateComponentRecord({ component: child, operation: "create", originalComponent: null, originalReference: null, generatedChildren: [], childRecords: [], stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, isTopLevel: false, layoutContext: cLayout }))
        .then((record) => ({ record, allRecords: [record] }));
    }
    if (!childMods.has(childId)) {
      // Untouched child: reuse its previous code verbatim.
      return limit(() => reuseComponentRecord({ prevComponent: prevChild, id: childId, stateContext, outDir, componentSpec: componentInputWithoutChildren(child, patchChildren(child)) }))
        .then((record) => ({ record, allRecords: [record] }));
    }
    // Modified child: regenerate from its previous code, changing only the
    // described part.
    const instruction = changeTextFor(childMods.get(childId));
    return limit(() => generateComponentRecord({ component: child, operation: "update", originalComponent: prevChild, originalReference: null, generatedChildren: [], childRecords: [], stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, isTopLevel: false, layoutContext: cLayout, updateInstruction: instruction }))
      .then((record) => ({ record, allRecords: [record] }));
  }));

  for (let index = 0; index < children.length; index++) {
    const childResult = childResults[index];
    const childId = children[index].id || children[index].name;
    for (const record of childResult.allRecords) allRecords.push(record);
    if (childId && childResult.record) generatedById[childId] = childResult.record.component;
  }

  const generatedChildren = childResults.map((result, index) => childImportMeta(result.record, children[index], index));
  const childRecords = childResults.flatMap((result) => result.allRecords);
  const component = componentInputWithoutChildren(patch, children);

  // Modifications that do not resolve to a direct child target the container
  // itself (e.g. "props.title", a bbox/layout change, or the container id).
  // Create-type mods describe new children, not the shell, so they are excluded.
  const selfMods = mods.filter((mod) => {
    if (isCreateType(mod)) return false;
    if (isDeleteType(mod)) return false;
    return !modChildId(mod, children, parentId);
  });

  let record;
  if (!prevParent || !prevParent.reactCode) {
    // No previous parent code to inherit: fall back to a normal update generation.
    record = await limit(() => generateComponentRecord({ component, operation: "update", originalComponent: prevParent || null, originalReference: prevParent ? null : registryReferenceFor(registry, parentId), generatedChildren, childRecords, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, isTopLevel: depth === 0, layoutContext }));
  } else if (selfMods.length || newChildIds.size || directDeleteIds.size) {
    // The container shell changed AND/OR a child was added/removed: regenerate
    // from the previous parent code, feeding it the SURVIVING child imports +
    // the current spec, so new children are inserted and deleted children
    // disappear. The instruction names the shell change, the new children to
    // add, and the children to remove; everything else must stay byte-identical
    // to the previous implementation.
    const instructionParts = [];
    if (selfMods.length) instructionParts.push(changeTextFor(selfMods));
    if (newChildIds.size) {
      const names = [...newChildIds];
      instructionParts.push(`新增子组件 ${names.join("、")} 并插入到容器的正确位置：这些子组件已作为 import 提供（见 generated_children），但原父组件代码里没有它们。请在保持其余结构、类名、样式与原实现完全一致的前提下，按 children 的顺序和各子组件 spec 把它们渲染进容器。`);
    }
    if (directDeleteIds.size) {
      const names = [...directDeleteIds];
      instructionParts.push(`删除子组件 ${names.join("、")}：从容器中彻底移除它们（不再渲染，也不要保留其 import、占位或残留样式）。这些子组件已不在 generated_children 中。请在保持其余结构、类名、样式与原实现完全一致的前提下，仅移除被删除的子组件。`);
    }
    record = await limit(() => generateComponentRecord({ component, operation: "update", originalComponent: prevParent, originalReference: null, generatedChildren, childRecords, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, isTopLevel: depth === 0, layoutContext, updateInstruction: instructionParts.filter(Boolean).join("；") }));
  } else {
    // Only children changed: re-render the previous parent code as-is. It still
    // imports the children by id, which now point at the updated child sources.
    record = await limit(() => reuseComponentRecord({ prevComponent: prevParent, id: parentId, stateContext, outDir, childRecords, operation: "update", componentSpec: component }));
  }
  allRecords.push(record);
  if (parentId) generatedById[parentId] = record.component;
  return { record, allRecords };
}

// For a rich update on an original DOM anchor there is no previous React
// source; the registry entry is passed as original_reference so the LLM knows
// the original card's real text/size instead of inventing content.
function registryReferenceFor(registry, id) {
  const entry = id ? registry?.semantic_dom_registry?.[id] : null;
  if (!entry) return null;
  return {
    anchor: id,
    component: entry.component || entry.semantic || null,
    text: typeof entry.text === "string" ? entry.text : "",
    bbox: Array.isArray(entry.bbox) ? entry.bbox : null,
  };
}

// Merge a container update's explicit `children` (often only newly created
// ones) with the last full children tree for this id, applying modifications
// onto the carried tree first. Without this, an update that lists only e.g.
// tip_card drops preserved siblings like product_option_list from the update
// pipeline even when modifications target them.
function resolveUpdateChildren(patch, patchId, lastChildrenById) {
  const explicit = patchChildren(patch);
  const prev = patchId && lastChildrenById && lastChildrenById.has(patchId)
    ? cloneJson(lastChildrenById.get(patchId))
    : null;
  if (!prev?.length) {
    if (explicit.length) applyChildModifications(explicit, patch.modifications, patchId);
    return explicit;
  }
  const merged = cloneJson(prev);
  applyChildModifications(merged, patch.modifications, patchId);
  for (const child of explicit) {
    const id = child?.id || child?.name;
    if (!id) continue;
    const idx = merged.findIndex((c) => (c?.id || c?.name) === id);
    if (idx >= 0) merged[idx] = { ...merged[idx], ...child, type: child.type || merged[idx].type || "update" };
    else merged.push(cloneJson(child));
  }
  return merged;
}

async function generatePatchTree({ patch, operation, depth, generatedById, lastChildrenById, registry, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, limit, layoutContext = null }) {
  const patchId = patch.id || patch.name;
  // Carry-forward: reuse the last children generated for this id and apply the
  // update's child-targeted modifications. Also merge explicit patch children
  // (usually only new ones) so preserved siblings stay in the pipeline.
  if (operation === "update" && patchId && lastChildrenById) {
    const resolved = resolveUpdateChildren(patch, patchId, lastChildrenById);
    if (resolved.length) patch = { ...patch, children: resolved };
  }
  const children = patchChildren(patch);

  // Inheritance-preserving container update: when a container is updated with a
  // modification list and we already have its previous render, reuse untouched
  // children, regenerate only modified children from their own previous code,
  // and re-stitch the parent (regenerate only if its own shell changed). This
  // avoids re-authoring the whole subtree every state, which caused styling to
  // drift between e.g. state_4 and state_5 dialogs.
  if (operation === "update" && children.length
    && Array.isArray(patch.modifications) && patch.modifications.length
    && patchId && generatedById[patchId] && generatedById[patchId].reactCode) {
    const result = await generateContainerUpdate({ patch, children, depth, generatedById, lastChildrenById, registry, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, limit, layoutContext });
    if (patchId && lastChildrenById && children.length) lastChildrenById.set(patchId, cloneJson(children));
    return result;
  }

  const allRecords = [];

  // Sibling children are independent: each is generated and rendered into its
  // own id-keyed source file, and the parent imports them only after all are
  // ready. Generate them in parallel (bounded by the shared `limit`), then
  // commit results into shared state in deterministic order.
  const directChildResults = await Promise.all(children.map((child) => generatePatchTree({
    patch: child,
    operation: child.type === "update" ? "update" : "create",
    depth: depth + 1,
    generatedById,
    lastChildrenById,
    registry,
    stateContext,
    viewport,
    modelName,
    skill,
    resourcesDir,
    componentsDir,
    maxTokens,
    useFallback,
    outDir,
    rawDir,
    limit,
    layoutContext: childLayoutContext({ parent: patch, child, parentLayoutContext: layoutContext }),
  })));
  for (let index = 0; index < children.length; index++) {
    const childResult = directChildResults[index];
    const childId = children[index].id || children[index].name;
    for (const record of childResult.allRecords) allRecords.push(record);
    if (childId && childResult.record) generatedById[childId] = childResult.record.component;
  }

  const component = componentInputWithoutChildren(enrichOriginalAnchorPatch(patch), children);
  const generatedChildren = directChildResults.map((result, index) => childImportMeta(result.record, children[index], index));
  const childRecords = directChildResults.flatMap((result) => result.allRecords);
  const id = component.id || component.name;
  // The parent's OWN generation runs only after its children are done, so
  // holding a limiter slot here cannot block a child and cannot deadlock.
  const record = await limit(() => generateComponentRecord({
    component,
    operation,
    originalComponent: operation === "update" ? generatedById[id] || null : null,
    originalReference: operation === "update" && !generatedById[id] ? registryReferenceFor(registry, id) : null,
    generatedChildren,
    childRecords,
    stateContext,
    viewport,
    modelName,
    skill,
    resourcesDir,
    componentsDir,
    maxTokens,
    useFallback,
    outDir,
    rawDir,
    isTopLevel: depth === 0,
    layoutContext,
  }));
  allRecords.push(record);
  if (id) generatedById[id] = record.component;
  // Remember the children specs actually used for this id so a later state's
  // update can carry them forward when it omits `children`.
  if (id && lastChildrenById && children.length) lastChildrenById.set(id, cloneJson(children));
  return { record, allRecords };
}

async function main() {
  loadSkillEnv();
  configureNodePath();
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  const base = resolveArgPath(args[0] || ".", cwd);
  const modelName = resolveTextModel(argValue(args, "--model", ""));
  const stateModelPath = resolveArgPath(
    argValue(args, "--state-model", path.join(base, ".run_skill/latest/state_implementation/state_implementation_model.llm.json")),
    cwd,
  );
  const outDir = resolveArgPath(
    argValue(args, "--out-dir", path.join(base, ".run_skill", "component_codegen")),
    cwd,
  );
  const width = Number(argValue(args, "--width", "360"));
  const height = Number(argValue(args, "--height", "792"));
  const maxTokens = Number(argValue(args, "--max-tokens", "5000"));
  const useFallback = args.includes("--fallback");
  const concurrency = Number(argValue(args, "--concurrency", "8"));

  const stateModel = readJson(stateModelPath);
  const registryPath = resolveArgPath(
    argValue(args, "--registry", path.join(base, ".preprocess", "semantic_registry.json")),
    cwd,
  );
  let registry = null;
  try { registry = readJson(registryPath); } catch (err) { registry = null; }
  const skill = readUtf8(path.resolve(__dirname, "..", "SKILL.md"));

  const resourcesDir = path.resolve(__dirname, "../../../resources");
  const componentsDir = path.join(resourcesDir, "components");
  const generatedById = {};
  // id -> children specs last used to render that component, so a later state's
  // container update that omits `children` can carry them forward.
  const lastChildrenById = new Map();
  const components = [];
  const rawDir = path.join(outDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  // One shared gate caps total in-flight component generations (LLM + render)
  // across top-level patches AND their parallel children to `concurrency`.
  const limit = createLimiter(concurrency);

  const createdIds = new Set();
  for (const state of stateModel.states || []) {
    for (const p of state.inheritance?.create || []) {
      const cid = p?.id || p?.name;
      if (cid) createdIds.add(cid);
    }
  }

  for (const state of stateModel.states || []) {
    const stateContext = { id: state.id, label: state.label, ui_intent: state.ui_intent, parent_state: state.parent_state, height: state.height || height };
    const viewport = { width, initial_height: height };
    const createPatches = (state.inheritance?.create || []).filter((component) => component.id || component.name);
    const createResults = await mapLimit(
      createPatches,
      concurrency,
      (patch) => generatePatchTree({ patch, operation: "create", depth: 0, generatedById, lastChildrenById, registry, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, limit })
    );
    for (const result of createResults) {
      for (const record of result.allRecords) components.push(record);
    }

    // Updates whose modifications only change text/style/bbox inside the keep
    // clone skip codegen; content/structure switches go through generatePatchTree
    // with registry original_reference as the starting point.
    const updatePatches = (state.inheritance?.update || [])
      .filter((component) => component.id || component.name)
      .filter((patch) => updatePatchNeedsCodegen(patch, registry, createdIds));
    const updateResults = await mapLimit(
      updatePatches,
      concurrency,
      (patch) => generatePatchTree({ patch, operation: "update", depth: 0, generatedById, lastChildrenById, registry, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, limit })
    );
    for (const result of updateResults) {
      for (const record of result.allRecords) components.push(record);
    }
  }

  const output = { ok: true, source_state_model: rel(stateModelPath), components };
  writeJson(path.join(outDir, "component_codegen.generated.json"), output);
  writeJson(path.join(outDir, "run_report.json"), { ok: true, component_count: components.length, output: rel(path.join(outDir, "component_codegen.generated.json")) });
  console.log(`[component-codegen] ok=true components=${components.length} out=${rel(path.join(outDir, "component_codegen.generated.json"))}`);
}

main().catch((err) => {
  console.error("[component-codegen] ERROR:", err.stack || err.message);
  process.exit(1);
});
