"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

const CODEGEN_ROOT = path.resolve(__dirname, "..");
const SKILL_ROOT = path.resolve(CODEGEN_ROOT, "../..");
const WORKSPACE_ROOT = path.resolve(SKILL_ROOT, "../../..");
const BACKEND_ROOT = path.join(WORKSPACE_ROOT, "backend");
const BACKEND_NODE_MODULES = path.join(BACKEND_ROOT, "node_modules");
const COMPONENTS_DIR = path.join(CODEGEN_ROOT, "resources", "components");
const RENDER_DIR = path.join(CODEGEN_ROOT, ".react_ssr");
const SHIMS_DIR = path.join(RENDER_DIR, "shims");
const ENTRIES_DIR = path.join(RENDER_DIR, "entries");
const BUNDLES_DIR = path.join(RENDER_DIR, "bundles");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, "utf8");
}

function readUtf8(file) {
  return fs.readFileSync(file, "utf8");
}

function slash(file) {
  return file.replace(/\\/g, "/");
}

function safeName(name) {
  return String(name || "component").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function requireFromCandidates(pkg, extraCandidates = []) {
  const candidates = [
    RENDER_DIR,
    CODEGEN_ROOT,
    SKILL_ROOT,
    WORKSPACE_ROOT,
    BACKEND_ROOT,
    process.cwd(),
    ...extraCandidates,
  ];
  for (const candidate of candidates) {
    try {
      return require(require.resolve(pkg, { paths: [candidate] }));
    } catch (err) {
      // Keep looking in the next known local dependency root.
    }
  }
  throw new Error(`Missing dependency: ${pkg}`);
}

function ensureBackendNodePath() {
  if (!fs.existsSync(BACKEND_NODE_MODULES)) return;
  const parts = String(process.env.NODE_PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  if (!parts.includes(BACKEND_NODE_MODULES)) {
    process.env.NODE_PATH = [BACKEND_NODE_MODULES, ...parts].join(path.delimiter);
    Module._initPaths();
  }
}

function writeShims() {
  writeFile(path.join(SHIMS_DIR, "utils.js"), `
exports.cn = function cn() {
  return Array.prototype.slice.call(arguments).flat(Infinity).filter(Boolean).join(" ");
};
`);
  writeFile(path.join(SHIMS_DIR, "router.js"), `
exports.useLocation = function useLocation() { return { pathname: "/", search: "" }; };
exports.useNavigate = function useNavigate() { return function navigate() {}; };
`);
  writeFile(path.join(SHIMS_DIR, "workspaceStore.js"), `
exports.useWorkspaceStore = function useWorkspaceStore() { return { shortLabel: "工作台" }; };
`);
  writeFile(path.join(SHIMS_DIR, "emptyPage.js"), `
const React = require("react");
module.exports = function EmptyPage() { return React.createElement("div", null, "secondary page"); };
module.exports.default = module.exports;
`);
  writeFile(path.join(SHIMS_DIR, "liveStreamStore.js"), `
function useLiveStreamStore(selector) {
  const state = { isOpen: false, close: function close() {} };
  return typeof selector === "function" ? selector(state) : state;
}
useLiveStreamStore.getState = function getState() { return { isOpen: false, close: function close() {} }; };
exports.useLiveStreamStore = useLiveStreamStore;
`);
  writeFile(path.join(SHIMS_DIR, "solutionStore.js"), `
function useSolutionStore(selector) {
  const state = { isOpen: false, currentSolution: "", close: function close() {} };
  return typeof selector === "function" ? selector(state) : state;
}
useSolutionStore.getState = function getState() { return { isOpen: false, currentSolution: "", close: function close() {} }; };
exports.useSolutionStore = useSolutionStore;
`);
}

function aliasPlugin() {
  return {
    name: "taskflow-code-gen2-react-aliases",
    setup(build) {
      build.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({ path: path.join(SHIMS_DIR, "utils.js") }));
      build.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: path.join(SHIMS_DIR, "router.js") }));
      build.onResolve({ filter: /^@\/store\/workspaceStore$/ }, () => ({ path: path.join(SHIMS_DIR, "workspaceStore.js") }));
      build.onResolve({ filter: /^@\/store\/liveStreamStore$/ }, () => ({ path: path.join(SHIMS_DIR, "liveStreamStore.js") }));
      build.onResolve({ filter: /^@\/store\/solutionStore$/ }, () => ({ path: path.join(SHIMS_DIR, "solutionStore.js") }));
      build.onResolve({ filter: /^@\/pages\/secondary\/(live-stream|solution-case)$/ }, () => ({ path: path.join(SHIMS_DIR, "emptyPage.js") }));
      build.onResolve({ filter: /^@\/components\/(.+)$/ }, (args) => {
        const match = args.path.match(/^@\/components\/(.+)$/);
        return { path: path.join(COMPONENTS_DIR, match[1], "index.tsx") };
      });
    },
  };
}

function designSystemCss() {
  const globalCssPath = path.join(CODEGEN_ROOT, "resources", "global.css");
  if (!fs.existsSync(globalCssPath)) return "";
  return readUtf8(globalCssPath)
    .replace(/@import[^\n]+\n/g, "")
    .replace(/@tailwind[^\n]+\n/g, "")
    .trim();
}

async function renderReactCode({ id, reactCode, outDir, css = "" }) {
  if (!reactCode || typeof reactCode !== "string") {
    throw new Error("reactCode must be a non-empty string");
  }
  writeShims();
  ensureBackendNodePath();
  ensureDir(ENTRIES_DIR);
  ensureDir(BUNDLES_DIR);
  const esbuild = requireFromCandidates("esbuild");
  const name = safeName(id);
  const sourceFile = path.join(outDir || RENDER_DIR, "react_sources", `${name}.tsx`);
  const entryFile = path.join(ENTRIES_DIR, `${name}.entry.tsx`);
  const bundleFile = path.join(BUNDLES_DIR, `${name}.cjs`);

  writeFile(sourceFile, reactCode);
  writeFile(entryFile, `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Component from "${slash(sourceFile)}";

const html = renderToStaticMarkup(React.createElement(Component, {}));
if (!html || html.length < 20) throw new Error("Rendered HTML is empty or too short");
export default html;
`);

  await esbuild.build({
    entryPoints: [entryFile],
    outfile: bundleFile,
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    nodePaths: [BACKEND_NODE_MODULES].filter((dir) => fs.existsSync(dir)),
    external: ["react", "react-dom", "react-dom/server"],
    plugins: [aliasPlugin()],
    logLevel: "silent",
  });

  delete require.cache[require.resolve(bundleFile)];
  const rendered = require(bundleFile);
  const html = String(rendered.default || rendered);
  if (!html.includes(`data-component-id="${id}"`) && !html.includes(`data-component-id=${id}`)) {
    throw new Error(`Rendered HTML missing data-component-id="${id}"`);
  }
  return {
    html,
    css: [designSystemCss(), css || ""].filter(Boolean).join("\n\n"),
    sourceFile,
    bundleFile,
  };
}

module.exports = {
  CODEGEN_ROOT,
  COMPONENTS_DIR,
  designSystemCss,
  renderReactCode,
  requireFromCandidates,
  writeShims,
  aliasPlugin,
};
