"use strict";

const fs = require("fs");
const path = require("path");

const CODEGEN_ROOT = path.resolve(__dirname, "..");
const COMPONENTS_DIR = path.join(CODEGEN_ROOT, "resources", "components");
const CHECK_DIR = path.join(CODEGEN_ROOT, ".render_check");
const SHIMS_DIR = path.join(CHECK_DIR, "shims");
const ENTRIES_DIR = path.join(CHECK_DIR, "entries");
const BUNDLES_DIR = path.join(CHECK_DIR, "bundles");
const PAGES_DIR = path.join(CHECK_DIR, "pages");
const { aliasPlugin, designSystemCss, requireFromCandidates, writeShims } = require("./react_ssr");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, "utf8");
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(file));
    else if (entry.isFile() && entry.name === "index.tsx") out.push(file);
  }
  return out;
}

function slash(file) {
  return file.replace(/\\/g, "/");
}

function componentName(file) {
  return path.relative(COMPONENTS_DIR, path.dirname(file)).replace(/\\/g, "/");
}

function propsCode(name) {
  const noop = "() => {}";
  const samples = {
    BottomNav: "{}",
    ButtonBar: `{ variant: "dual", primaryLabel: "确认", secondaryLabel: "取消", onPrimaryClick: ${noop}, onSecondaryClick: ${noop} }`,
    CategoryTabs: `{ categories: [{ id: "phone", name: "手机" }, { id: "pad", name: "平板" }], activeId: "phone", onChange: ${noop} }`,
    CourseListItem: `{ course: { title: "任务流课程", subtitle: "快速入门", date: "今天", students: 128, gradient: "linear-gradient(135deg,#f2f3f5,#dde1e7)" }, onClick: ${noop} }`,
    EntryCard: `{ card: { title: "项目开局", subtitle: "创建开局", icon: "qr", color: "#C7000B" } }`,
    FilterPills: `{ filters: [{ id: "all", name: "全部" }, { id: "hot", name: "热门" }], activeId: "all", onChange: ${noop} }`,
    HotVideoCard: `{ title: "热门视频", description: "产品介绍", cover: "", views: "1.2万", duration: "03:20", onClick: ${noop} }`,
    IconGrid: `{ cols: 2, items: [{ icon: SampleIcon, label: "创建", color: "#C7000B" }, { icon: SampleIcon, label: "统计", color: "#FF8C42" }], variant: "card", title: "图标阵列" }`,
    InputDemo: `{ label: "标题名称", placeholder: "请输入", value: "示例文本", onChange: ${noop}, showToggle: true }`,
    LeftSidebar: `{ filters: [{ id: "all", name: "全部" }, { id: "mine", name: "我的" }], activeId: "all", onChange: ${noop} }`,
    MobileLayout: `{ children: React.createElement("div", null, "页面内容") }`,
    MoreButton: `{ text: "更多", onClick: ${noop} }`,
    ProductCard: `{ product: { id: "p1", name: "产品名称", description: "产品说明", price: 199 }, onClick: ${noop}, onAddToCart: ${noop} }`,
    ProductLayout: `{ filters: [{ id: "all", name: "全部" }], activeFilter: "all", onFilterChange: ${noop}, subFilters: [{ id: "hot", name: "热门" }], activeSubFilter: "hot", onSubFilterChange: ${noop}, products: [{ id: "p1", name: "产品名称", description: "产品说明", price: 199 }] }`,
    ProductSelectionListItem: `{ item: { id: "q1", name: "报价方案", description: "标准报价", price: 199, selected: true }, selected: true, onSelect: ${noop}, onMore: ${noop} }`,
    QuickEntryGrid: `{ title: "快捷入口", items: [{ icon: SampleIcon, label: "创建开局", color: "#C7000B" }, { icon: SampleIcon, label: "接收项目", color: "#FF8C42" }] }`,
    SectionLayout: `{ variant: "card", title: "模块标题", tabs: [{ id: "a", label: "全部" }, { id: "b", label: "热门" }], activeTab: "a", onTabChange: ${noop}, children: React.createElement("div", null, "模块内容") }`,
    SectionTitle: `{ variant: "card", title: "模块标题", moreText: "更多", onMore: ${noop} }`,
    StatCard: `{ items: [{ label: "线索", value: "128" }, { label: "转化", value: "32%" }], columns: 2 }`,
    StatusBar: "{}",
    StatusPill: `{ text: "进行中" }`,
    TopNav: `{ variant: "title", title: "页面标题", actions: ["search", "message"], onSearch: ${noop}, onMessage: ${noop} }`,
    UnderlineTabs: `{ tabs: [{ id: "a", label: "全部" }, { id: "b", label: "热门" }], activeId: "a", onChange: ${noop} }`,
    "ui/Button": `{ children: "按钮" }`,
  };
  return samples[name] || "{}";
}

function targetExpression(name) {
  if (name === "ui/Button") return "Mod.CapsuleButton || Mod.TextButton";
  return "Mod.default || DefaultComponent";
}

async function main() {
  writeShims();
  ensureDir(ENTRIES_DIR);
  ensureDir(BUNDLES_DIR);
  ensureDir(PAGES_DIR);

  const esbuild = requireFromCandidates("esbuild", [CHECK_DIR]);
  const results = [];
  const globalCss = designSystemCss();
  const files = walk(COMPONENTS_DIR).sort((a, b) => componentName(a).localeCompare(componentName(b)));

  for (const file of files) {
    const name = componentName(file);
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const entry = path.join(ENTRIES_DIR, `${safeName}.tsx`);
    const bundle = path.join(BUNDLES_DIR, `${safeName}.cjs`);
    writeFile(entry, `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DefaultComponent, * as Mod from "${slash(file)}";

const Component = ${targetExpression(name)};
const SampleIcon = (props) => React.createElement("svg", { viewBox: "0 0 24 24", width: props.size || 24, height: props.size || 24, style: props.style }, React.createElement("circle", { cx: 12, cy: 12, r: 8, fill: "currentColor" }));
if (!Component) throw new Error("No renderable default or named component export found");
const props = ${propsCode(name)};
const html = renderToStaticMarkup(React.createElement(Component, props));
if (!html || html.length < 20) throw new Error("Rendered HTML is empty or too short");
export default html;
`);

    try {
      await esbuild.build({
        entryPoints: [entry],
        outfile: bundle,
        bundle: true,
        platform: "node",
        format: "cjs",
        jsx: "automatic",
        external: ["react", "react-dom", "react-dom/server", "lucide-react"],
        plugins: [aliasPlugin()],
        logLevel: "silent",
      });
      delete require.cache[require.resolve(bundle)];
      const rendered = require(bundle);
      const html = rendered.default || rendered;
      const pagePath = path.join(PAGES_DIR, `${safeName}.html`);
      writeFile(pagePath, `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
${globalCss}
body{margin:0;background:#f2f3f5;font-family:HarmonyOS Sans SC,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.render-shell{width:360px;min-height:240px;margin:24px auto;padding:16px;background:#f2f3f5}
</style>
</head>
<body><main class="render-shell">${html}</main></body>
</html>`);
      results.push({ component: name, ok: true, htmlLength: String(html).length, page: path.relative(CODEGEN_ROOT, pagePath).replace(/\\/g, "/") });
    } catch (err) {
      results.push({ component: name, ok: false, error: err.message || String(err) });
    }
  }

  const report = {
    ok: results.every((item) => item.ok),
    total: results.length,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results,
  };
  writeFile(path.join(CHECK_DIR, "component_render_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
