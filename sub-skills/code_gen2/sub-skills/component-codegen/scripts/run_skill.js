"use strict";

const fs = require("fs");
const path = require("path");
const { renderReactCode } = require("../../../scripts/react_ssr");

const ROOT = path.resolve(__dirname, "../../../../../../../..");
const SKILL_ROOT = path.resolve(__dirname, "../../../../..");

function readUtf8(file) { return fs.readFileSync(file, "utf8"); }
function readJson(file) { return JSON.parse(readUtf8(file).replace(/^\uFEFF/, "")); }
function writeUtf8(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, "utf8"); }
function writeJson(file, value) { writeUtf8(file, JSON.stringify(value, null, 2)); }
function exists(file) { return fs.existsSync(file); }
function argValue(args, name, fallback) { const idx = args.indexOf(name); return idx >= 0 ? args[idx + 1] : fallback; }
function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }

function loadDotEnv(file) {
  if (!exists(file)) return;
  for (const line of readUtf8(file).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
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

// Resolve the child id a modification targets. The state-model emits several
// equivalent shapes for `target`, e.g. "children.name_input", a bare
// "name_input" (with a separate `parent` field), or a dotted path like
// "name_input.props.value". Normalize all of them to the leading child id.
function modTargetChildId(mod) {
  let target = String(mod?.target || "").trim();
  if (!target) return "";
  target = target.replace(/^children\./, "");
  return target.split(".")[0].trim();
}

// Apply a container update patch's child-targeted modifications onto carried-
// forward child specs, using `set_props` / `set_text` / `set_text_style`. Used
// when an update patch does not re-state its `children` array (the SKILL treats
// unlisted parts as preserved), so the previous children are reused with only
// the listed changes. A modification only applies when its resolved child id
// actually matches a carried child, so container-level mods (e.g. target
// "props.title") are safely ignored here.
function applyChildModifications(children, modifications) {
  for (const mod of Array.isArray(modifications) ? modifications : []) {
    const childId = modTargetChildId(mod);
    if (!childId) continue;
    const child = findChildById(children, childId);
    if (!child) continue;
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
    const systemPrompt = [
      skill,
      buildComponentLibSection({ resourcesDir, componentsDir, component }),
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
  parsed = mergeChildCss(parsed, childRecords || []);
  issues = validateComponent(parsed, id);
  if (issues.length) {
    const fb = fallbackComponent({ component: componentForInput, operation, originalComponent, generatedChildren, layoutContext });
    ownCss = fb.css || "";
    parsed = mergeChildCss(fb, childRecords || []);
  }
  try {
    parsed = await renderComponentRecord(parsed, { id, outDir });
  } catch (err) {
    issues.push("react render failed: " + err.message);
    const fb = fallbackComponent({ component: componentForInput, operation, originalComponent, generatedChildren, layoutContext });
    ownCss = fb.css || "";
    parsed = await renderComponentRecord(mergeChildCss(fb, childRecords || []), { id, outDir });
  }
  if (parsed && typeof parsed === "object") parsed.ownCss = ownCss;
  if (raw) writeUtf8(path.join(rawDir, `${stateContext.id}_${operation}_${id}.raw.txt`), raw);
  return { state_id: stateContext.id, operation, original_component_id: originalComponent?.id || null, component: parsed, input, issues };
}

// Re-render a previously generated component from its OWN React source without
// any LLM call, so a child/parent that did not change keeps byte-identical
// styling across states. The source file is rewritten to outDir so a parent that
// imports it (by id) picks up the same code, and child CSS is re-merged so the
// container's CSS still includes its children.
async function reuseComponentRecord({ prevComponent, id, stateContext, outDir, childRecords = [], operation = "reuse" }) {
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
  parsed = mergeChildCss(parsed, childRecords || []);
  let issues = [];
  try {
    parsed = await renderComponentRecord(parsed, { id, outDir });
  } catch (err) {
    issues = ["reuse render failed: " + err.message];
  }
  if (parsed && typeof parsed === "object") parsed.ownCss = ownCss;
  return { state_id: stateContext.id, operation, original_component_id: id, component: parsed, input: { operation, reused_from: id }, issues };
}

// Surgical container update implementing inheritance-preserving update:
//  1. children NOT touched by any modification are reused verbatim;
//  2. children targeted by a modification are regenerated FROM their previous
//     React code under a strict "only change <change>" constraint;
//  3. the parent shell is regenerated (from its previous React code + new child
//     imports + spec, constrained) ONLY when a modification targets the
//     container itself; otherwise the previous parent code is re-rendered as-is
//     so it re-imports the now-updated child sources.
// This keeps the look of unchanged parts identical between states instead of
// re-authoring every component from scratch on each update.
async function generateContainerUpdate({ patch, children, depth, generatedById, lastChildrenById, registry, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, limit, layoutContext }) {
  const parentId = patch.id || patch.name;
  const prevParent = generatedById[parentId];
  const allRecords = [];
  const mods = Array.isArray(patch.modifications) ? patch.modifications : [];

  const childMods = new Map();
  for (const mod of mods) {
    const cid = modTargetChildId(mod);
    if (cid && findChildById(children, cid)) {
      const arr = childMods.get(cid) || [];
      arr.push(mod);
      childMods.set(cid, arr);
    }
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
    // normal recursive path (it may be a nested create/update in its own right).
    if (patchChildren(child).length) {
      return generatePatchTree({ patch: child, operation: child.type === "update" ? "update" : "create", ...shared, layoutContext: cLayout })
        .then((res) => ({ record: res.record, allRecords: res.allRecords }));
    }
    if (!prevChild || !prevChild.reactCode) {
      // No previous version to inherit from: create it fresh.
      return limit(() => generateComponentRecord({ component: child, operation: "create", originalComponent: null, originalReference: null, generatedChildren: [], childRecords: [], stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, isTopLevel: false, layoutContext: cLayout }))
        .then((record) => ({ record, allRecords: [record] }));
    }
    if (!childMods.has(childId)) {
      // Untouched child: reuse its previous code verbatim.
      return limit(() => reuseComponentRecord({ prevComponent: prevChild, id: childId, stateContext, outDir }))
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
  const selfMods = mods.filter((mod) => {
    const cid = modTargetChildId(mod);
    return !(cid && findChildById(children, cid));
  });

  let record;
  if (!prevParent || !prevParent.reactCode) {
    // No previous parent code to inherit: fall back to a normal update generation.
    record = await limit(() => generateComponentRecord({ component, operation: "update", originalComponent: prevParent || null, originalReference: prevParent ? null : registryReferenceFor(registry, parentId), generatedChildren, childRecords, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, isTopLevel: depth === 0, layoutContext }));
  } else if (selfMods.length) {
    // The container shell changed: regenerate from its previous code, constrained
    // to only the described shell change, reusing the (updated) child imports.
    record = await limit(() => generateComponentRecord({ component, operation: "update", originalComponent: prevParent, originalReference: null, generatedChildren, childRecords, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, isTopLevel: depth === 0, layoutContext, updateInstruction: changeTextFor(selfMods) }));
  } else {
    // Only children changed: re-render the previous parent code as-is. It still
    // imports the children by id, which now point at the updated child sources.
    record = await limit(() => reuseComponentRecord({ prevComponent: prevParent, id: parentId, stateContext, outDir, childRecords, operation: "update" }));
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

async function generatePatchTree({ patch, operation, depth, generatedById, lastChildrenById, registry, stateContext, viewport, modelName, skill, resourcesDir, componentsDir, maxTokens, useFallback, outDir, rawDir, limit, layoutContext = null }) {
  const patchId = patch.id || patch.name;
  // Carry-forward: a container update that does not re-state its `children`
  // would otherwise re-render without its previously generated children (e.g. a
  // dialog losing its footer/input). Reuse the last children generated for this
  // id and apply only the update's child-targeted modifications.
  if (operation === "update" && patchChildren(patch).length === 0 && patchId && lastChildrenById && lastChildrenById.has(patchId)) {
    const carried = cloneJson(lastChildrenById.get(patchId));
    applyChildModifications(carried, patch.modifications);
    patch = { ...patch, children: carried };
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

  const component = componentInputWithoutChildren(patch, children);
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
  const args = process.argv.slice(2);
  const base = path.resolve(ROOT, args[0] || ".");
  const modelName = argValue(args, "--model", "qwen3.7-max");
  const stateModelPath = path.resolve(ROOT, argValue(args, "--state-model", path.join(base, ".run_skill/latest/state_implementation/state_implementation_model.llm.json")));
  const outDir = path.resolve(ROOT, argValue(args, "--out-dir", path.join(base, ".run_skill", "component_codegen")));
  const width = Number(argValue(args, "--width", "360"));
  const height = Number(argValue(args, "--height", "792"));
  const maxTokens = Number(argValue(args, "--max-tokens", "5000"));
  const useFallback = args.includes("--fallback");
  const concurrency = Number(argValue(args, "--concurrency", "8"));

  const stateModel = readJson(stateModelPath);
  const registryPath = path.resolve(ROOT, argValue(args, "--registry", path.join(base, ".preprocess", "semantic_registry.json")));
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

    // Updates on original anchors without structural/rich payload render via
    // the page-layer clone-and-apply path (previous implementation + ledger);
    // generating a component for them wastes tokens and produces empty shells.
    function cloneRenderedUpdate(patch) {
      const id = patch.id || patch.name;
      if (!registry?.semantic_dom_registry?.[id] || generatedById[id]) return false;
      if (Array.isArray(patch.children) && patch.children.length) return false;
      if (String(patch.content_density || "").toLowerCase() === "rich") return false;
      const props = patch.props && typeof patch.props === "object" && !Array.isArray(patch.props) ? patch.props : {};
      return !Object.keys(props).some((key) => !/^(layoutRole|zIndex)$/i.test(key));
    }
    const updatePatches = (state.inheritance?.update || [])
      .filter((component) => component.id || component.name)
      .filter((patch) => !cloneRenderedUpdate(patch));
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
