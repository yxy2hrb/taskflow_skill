"use strict";

const fs = require("fs");
const path = require("path");
const { resolveArgPath } = require("./paths");
const START = "<!-- tf-state-key-nav:start -->";
const END = "<!-- tf-state-key-nav:end -->";

function usage() {
  return [
    "Usage: node .cursor/skills/taskflow-llm-pagegen/scripts/inject_state_key_nav.js <html...>",
    "",
    "Injects A/D keyboard navigation into generated taskflow state-layer HTML.",
  ].join("\n");
}

function resolveInput(file) {
  return resolveArgPath(file);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSnippet() {
  return `${START}
<script id="tf-state-key-nav">
(function(){
  if (window.__TF_STATE_KEY_NAV_INSTALLED__) return;
  window.__TF_STATE_KEY_NAV_INSTALLED__ = true;

  function stateNumber(value) {
    var match = String(value || "").match(/(\\d+)/);
    return match ? Number(match[1]) : 0;
  }

  function stateNumbers() {
    var fromModel = ((window.__TF_STATE_MODEL__ || {}).states || [])
      .map(function(state){ return stateNumber(state && state.id); })
      .filter(function(n){ return n > 0; });
    var fromDom = Array.prototype.map.call(document.querySelectorAll(".tf-state-layer[id^='tf-state-']"), function(layer){
      return stateNumber(layer.id);
    }).filter(function(n){ return n > 0; });
    var merged = fromModel.concat(fromDom);
    var unique = [];
    merged.forEach(function(n){
      if (unique.indexOf(n) < 0) unique.push(n);
    });
    unique.sort(function(a, b){ return a - b; });
    return unique.length ? unique : [1];
  }

  function isEditableTarget(target) {
    if (!target) return false;
    var tag = String(target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }

  function currentStateNumber(states) {
    var current = window.TF && stateNumber(window.TF.current);
    if (current > 0) return current;
    var visible = Array.prototype.find.call(document.querySelectorAll(".tf-state-layer[id^='tf-state-']"), function(layer){
      return layer.style.display !== "none";
    });
    return stateNumber(visible && visible.id) || states[0] || 1;
  }

  document.addEventListener("keydown", function(event){
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
    var key = String(event.key || "").toLowerCase();
    if (key !== "a" && key !== "d") return;
    if (!window.TF || typeof window.TF.goto !== "function") return;

    var states = stateNumbers();
    var current = currentStateNumber(states);
    var index = states.indexOf(current);
    if (index < 0) index = 0;
    var nextIndex = key === "a" ? Math.max(0, index - 1) : Math.min(states.length - 1, index + 1);
    var next = states[nextIndex];
    if (next !== current) {
      event.preventDefault();
      window.TF.goto(next);
    }
  });
})();
</script>
${END}`;
}

function inject(html) {
  const snippet = buildSnippet();
  const pattern = new RegExp(`${escapeRegExp(START)}[\\s\\S]*?${escapeRegExp(END)}`, "m");
  if (pattern.test(html)) return html.replace(pattern, snippet);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}\n`;
}

function injectFile(file) {
  const before = fs.readFileSync(file, "utf8");
  const after = inject(before);
  fs.writeFileSync(file, after, "utf8");
  return after !== before;
}

function main() {
  const args = process.argv.slice(2).filter(Boolean);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    process.exit(args.length ? 0 : 1);
  }

  for (const arg of args) {
    const file = resolveInput(arg);
    injectFile(file);
    console.log(`[inject-state-key-nav] updated ${file.replace(/\\/g, "/")}`);
  }
}

module.exports = {
  buildStateKeyNavSnippet: buildSnippet,
  injectStateKeyNav: inject,
  injectStateKeyNavIntoFile: injectFile,
};

if (require.main === module) {
  main();
}