#!/usr/bin/env node
"use strict";

/**
 * Re-run code_gen2 generation stages from an existing state_implementation_model:
 *   state-model (optional skip) -> component-codegen -> page-layer
 *
 * Usage:
 *   node scripts/rerun_from_state_model.js <runDir> [--state-model <path>] [--width 360] [--height 792]
 *
 * Paths may be absolute or relative to the current working directory.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  SKILL_ROOT,
  loadSkillEnv,
  configureNodePath,
  resolveArgPath,
} = require("./paths");
const { resolveTextModel } = require("./llm_config");

function argValue(args, name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
}

function run(script, args, label) {
  return new Promise((resolve) => {
    console.log(`[${label}] START`);
    const start = Date.now();
    const child = spawn(process.execPath, [script, ...args], { stdio: "inherit", env: process.env });
    child.on("close", (code) => {
      console.log(`[${label}] exit ${code} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      resolve(code);
    });
  });
}

async function main() {
  loadSkillEnv();
  configureNodePath();

  const args = process.argv.slice(2);
  const cwd = process.cwd();
  const runDirArg = args.find((a) => !a.startsWith("--"));
  if (!runDirArg) {
    console.error("Usage: node scripts/rerun_from_state_model.js <runDir> [--state-model <path>] [--width W] [--height H]");
    process.exit(1);
  }

  const runDir = resolveArgPath(runDirArg, cwd);
  if (!fs.existsSync(runDir)) {
    console.error("runDir not found:", runDir);
    process.exit(1);
  }

  const caseDir = path.dirname(path.dirname(runDir));
  const defaultSm = path.join(runDir, "state_implementation/state_implementation_model.llm.json");
  const stateModel = resolveArgPath(argValue(args, "--state-model", defaultSm), cwd);
  const width = argValue(args, "--width", "360");
  const height = argValue(args, "--height", "792");
  const model = resolveTextModel(argValue(args, "--model", ""));

  const htmlPath = path.join(runDir, "preprocess/Index.preprocessed.html");
  const registryPath = path.join(runDir, "preprocess/semantic_registry.json");
  const blueprintPath = path.join(runDir, "blueprint/stages/blueprint_builder_input.json");
  if (!fs.existsSync(stateModel)) { console.error("missing state model:", stateModel); process.exit(1); }
  if (!fs.existsSync(htmlPath)) { console.error("missing preprocessed html:", htmlPath); process.exit(1); }
  if (!fs.existsSync(registryPath)) { console.error("missing registry:", registryPath); process.exit(1); }

  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const baseOut = path.join(runDir, `rerun_cgpl_${ts}`);
  const cgOut = path.join(baseOut, "code_gen2_component_codegen");
  const plOut = path.join(baseOut, "code_gen2_llm_layer_codegen");
  fs.mkdirSync(cgOut, { recursive: true });
  fs.mkdirSync(plOut, { recursive: true });

  const CG = path.join(SKILL_ROOT, "sub-skills/code_gen2/sub-skills/component-codegen/scripts/run_skill.js");
  const PL = path.join(SKILL_ROOT, "sub-skills/code_gen2/sub-skills/page-layer/scripts/run_skill.js");

  const cgCode = await run(CG, [
    caseDir,
    "--model", model,
    "--state-model", stateModel,
    "--registry", registryPath,
    "--width", width,
    "--height", height,
    "--out-dir", cgOut,
  ], "component-codegen");
  if (cgCode !== 0) process.exit(1);

  const cgJson = path.join(cgOut, "component_codegen.generated.json");
  const plArgs = [
    caseDir,
    "--html", htmlPath,
    "--state-model", stateModel,
    "--component-codegen", cgJson,
    "--registry", registryPath,
    "--width", width,
    "--height", height,
    "--out-dir", plOut,
    "--out-html", path.join(plOut, "Index.html"),
  ];
  if (fs.existsSync(blueprintPath)) plArgs.push("--blueprint", blueprintPath);

  const plCode = await run(PL, plArgs, "page-layer");
  if (plCode !== 0) process.exit(1);

  console.log("[done] output:", plOut);
  console.log("[done] shots:", path.join(plOut, "auto_shots"));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
