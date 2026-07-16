#!/usr/bin/env node

const ACTION_CLASSES = Object.freeze(["diagnostic", "safe-read", "mutation", "lifecycle-control"]);
const RISK_ORDER = Object.freeze({ diagnostic: 0, "safe-read": 1, "lifecycle-control": 2, mutation: 3 });
const SURFACES = Object.freeze(["daemon", "legacy", "batchEmitted"]);

function entry(classification, surfaces) {
  return Object.freeze({ classification, surfaces: Object.freeze([...surfaces].sort()) });
}

const ACTION_REGISTRY = Object.freeze({
  "apply": entry("mutation", ["daemon", "legacy", "batchEmitted"]),
  "apply-current": entry("mutation", ["daemon", "batchEmitted"]),
  "batch-read": entry("safe-read", ["daemon", "legacy"]),
  "copy": entry("mutation", ["daemon", "legacy"]),
  "delist": entry("mutation", ["daemon", "legacy"]),
  "discard-current-form": entry("lifecycle-control", ["daemon", "batchEmitted"]),
  "hello": entry("diagnostic", ["daemon"]),
  "image-order": entry("mutation", ["daemon", "batchEmitted"]),
  "image-pick": entry("mutation", ["daemon", "batchEmitted"]),
  "image-read": entry("safe-read", ["daemon", "legacy", "batchEmitted"]),
  "image-upload": entry("mutation", ["daemon", "legacy", "batchEmitted"]),
  "image-verify": entry("safe-read", ["daemon", "legacy", "batchEmitted"]),
  "login": entry("lifecycle-control", ["daemon", "legacy", "batchEmitted"]),
  "navigate": entry("lifecycle-control", ["daemon", "legacy"]),
  "ping": entry("diagnostic", ["daemon"]),
  "platform-search": entry("safe-read", ["daemon", "legacy"]),
  "read": entry("safe-read", ["daemon", "legacy", "batchEmitted"]),
  "screenshot": entry("safe-read", ["legacy"]),
  "spec-add-and-refresh": entry("mutation", ["daemon", "batchEmitted"]),
  "spec-add-dim": entry("mutation", ["daemon"]),
  "spec-add-item": entry("mutation", ["daemon"]),
  "spec-discover": entry("safe-read", ["daemon"]),
  "spec-refresh": entry("mutation", ["daemon"]),
  "spec-remove-dim": entry("mutation", ["daemon"]),
  "spec-remove-item": entry("mutation", ["daemon"]),
  "submit": entry("mutation", ["daemon", "legacy", "batchEmitted"]),
  "tenancy-set": entry("mutation", ["daemon", "batchEmitted"]),
  "vas-apply": entry("mutation", ["daemon", "batchEmitted"]),
  "vas-catalog-read": entry("safe-read", ["daemon", "batchEmitted"]),
  "vas-read": entry("safe-read", ["daemon", "batchEmitted"]),
  "vas-verify": entry("safe-read", ["daemon", "batchEmitted"]),
  "verify": entry("safe-read", ["legacy"]),
  "white-image-set": entry("mutation", ["daemon", "batchEmitted"]),
});

function normalizeAction(action) {
  return typeof action === "string" ? action.trim() : "";
}

function classifyAction(action, registry = ACTION_REGISTRY) {
  const normalized = normalizeAction(action);
  const metadata = normalized && Object.prototype.hasOwnProperty.call(registry, normalized) ? registry[normalized] : null;
  if (!metadata || !ACTION_CLASSES.includes(metadata.classification) || normalized.includes("*")) {
    return { action: normalized || null, classification: null, allowed: false, blocked: true, reason: "ACTION_NOT_CLASSIFIED" };
  }
  return { action: normalized, classification: metadata.classification, allowed: true, blocked: false, surfaces: [...metadata.surfaces] };
}

function classifyComposite(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return { classification: null, allowed: false, blocked: true, reason: "empty_composite", children: [], blockedChildren: [] };
  }
  const children = commands.map(command => classifyAction(command && command.action));
  const blockedChildren = children.filter(child => !child.allowed).map(child => child.action).filter(Boolean);
  if (children.some(child => !child.allowed)) {
    return { classification: null, allowed: false, blocked: true, reason: "ACTION_NOT_CLASSIFIED", children, blockedChildren };
  }
  const classification = children.reduce((highest, child) => RISK_ORDER[child.classification] > RISK_ORDER[highest] ? child.classification : highest, "diagnostic");
  return { classification, allowed: true, blocked: false, children, blockedChildren: [] };
}

function validateRegistryCoverage(inventory, registry = ACTION_REGISTRY) {
  const missing = new Set();
  const invalid = new Set();
  for (const surface of SURFACES) {
    const actions = inventory && Array.isArray(inventory[surface]) ? inventory[surface] : [];
    for (const action of actions) {
      const metadata = registry[action];
      if (!metadata) {
        missing.add(action);
        continue;
      }
      if (!ACTION_CLASSES.includes(metadata.classification)
        || !Array.isArray(metadata.surfaces)
        || !metadata.surfaces.includes(surface)
        || action.includes("*")) invalid.add(action);
    }
  }
  for (const [action, metadata] of Object.entries(registry)) {
    if (!ACTION_CLASSES.includes(metadata && metadata.classification)
      || !Array.isArray(metadata && metadata.surfaces)
      || metadata.surfaces.some(surface => !SURFACES.includes(surface))
      || action.includes("*")) invalid.add(action);
  }
  return {
    ok: missing.size === 0 && invalid.size === 0,
    missing: [...missing].sort(),
    invalid: [...invalid].sort(),
  };
}

function listActions() {
  return Object.keys(ACTION_REGISTRY).sort().map(action => ({ action, ...ACTION_REGISTRY[action], surfaces: [...ACTION_REGISTRY[action].surfaces] }));
}

function runCli() {
  process.stdout.write(JSON.stringify({ actionClasses: ACTION_CLASSES, actions: listActions() }, null, 2) + "\n");
}

if (require.main === module) runCli();

module.exports = {
  ACTION_CLASSES,
  ACTION_REGISTRY,
  classifyAction,
  classifyComposite,
  listActions,
  validateRegistryCoverage,
};
