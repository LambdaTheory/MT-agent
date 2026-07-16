const { isDeepStrictEqual } = require("util");

const { compareSemver, parseSemver } = require("./version-contract");

const CONTRACT_VERSION = 2;
const MAX_DEFINITION_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10000;
const MAX_STRING_LENGTH = 64 * 1024;
const MAX_STEPS = 64;
const MAX_OPERATIONS_PER_STEP = 128;
const MAX_OPERATIONS = 512;
const DEFINITION_FIELDS = new Set(["contractVersion", "sources", "steps"]);
const SOURCE_FIELDS = new Set(["configSchema", "stateSchema"]);
const RANGE_FIELDS = new Set(["min", "max"]);
const STEP_FIELDS = new Set(["domain", "kinds", "from", "to", "operations"]);
const OPERATION_FIELDS = Object.freeze({
  add: new Set(["op", "path", "value"]),
  remove: new Set(["op", "path"]),
  replace: new Set(["op", "path", "value"]),
  test: new Set(["op", "path", "value"]),
});
const DOMAIN_KINDS = Object.freeze({
  configSchema: new Set(["config"]),
  stateSchema: new Set(["task-index", "task", "batch"]),
});
const FORBIDDEN_POINTER_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function fail(message, details) {
  const error = new Error(message);
  error.code = "TARGET_MIGRATION_DEFINITION_INVALID";
  if (details !== undefined) error.details = details;
  throw error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rejectUnknownFields(value, allowed, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(context + " must be an object");
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) fail("Unknown " + context + " field: " + unknown[0], { field: unknown[0] });
}

function validateJsonShape(value) {
  let nodes = 0;
  function visit(candidate, depth) {
    nodes++;
    if (nodes > MAX_JSON_NODES) fail("Migration definition exceeds the JSON node limit");
    if (depth > MAX_JSON_DEPTH) fail("Migration definition exceeds the JSON depth limit");
    if (typeof candidate === "string" && candidate.length > MAX_STRING_LENGTH) fail("Migration definition contains an oversized string");
    if (!candidate || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(candidate)) {
      if (key.length > MAX_STRING_LENGTH) fail("Migration definition contains an oversized field name");
      visit(item, depth + 1);
    }
  }
  visit(value, 0);
}

function validateSources(sources) {
  rejectUnknownFields(sources, SOURCE_FIELDS, "migration definition sources");
  for (const domain of SOURCE_FIELDS) {
    const ranges = sources[domain];
    if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > MAX_STEPS) fail("Migration definition source ranges are invalid", { domain });
    for (const range of ranges) {
      rejectUnknownFields(range, RANGE_FIELDS, "migration definition source range");
      validateSemver(range.min, "migration.definition.sources." + domain + ".min");
      validateSemver(range.max, "migration.definition.sources." + domain + ".max");
      if (compareSemver(range.min, range.max) > 0) fail("Migration definition source range minimum exceeds maximum", { domain, range });
    }
  }
}

function validateSemver(value, field) {
  try {
    return parseSemver(value, field);
  } catch (error) {
    fail("Migration definition contains malformed semantic version metadata", { field, value, cause: error.message });
  }
}

function versionInRanges(version, ranges) {
  return ranges.some(range => compareSemver(version, range.min) >= 0 && compareSemver(version, range.max) <= 0);
}

function parsePointer(pointer) {
  if (typeof pointer !== "string" || pointer.length === 0 || pointer.length > MAX_STRING_LENGTH || pointer[0] !== "/") {
    fail("Migration operation path must be a non-root JSON Pointer");
  }
  return pointer.slice(1).split("/").map(raw => {
    if (/~(?:[^01]|$)/.test(raw)) fail("Migration operation path contains invalid JSON Pointer escaping", { path: pointer });
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (FORBIDDEN_POINTER_SEGMENTS.has(segment)) fail("Migration operation path contains a forbidden segment", { path: pointer, segment });
    return segment;
  });
}

function validateDefinition(definition, manifestMigration, targetSchemas) {
  validateJsonShape(definition);
  rejectUnknownFields(definition, DEFINITION_FIELDS, "migration definition");
  if (definition.contractVersion !== CONTRACT_VERSION) fail("Migration definition must declare contractVersion 2");
  validateSources(definition.sources);
  if (!isDeepStrictEqual(definition.sources, manifestMigration.sources)) fail("Migration definition sources must exactly match release-manifest.json");
  if (!Array.isArray(definition.steps) || definition.steps.length > MAX_STEPS) fail("Migration definition steps exceed the limit");

  let operationCount = 0;
  const selectors = new Set();
  for (const step of definition.steps) {
    rejectUnknownFields(step, STEP_FIELDS, "migration step");
    const allowedKinds = DOMAIN_KINDS[step.domain];
    if (!allowedKinds) fail("Migration step has an unsupported domain", { domain: step.domain });
    if (!Array.isArray(step.kinds) || step.kinds.length === 0 || new Set(step.kinds).size !== step.kinds.length) fail("Migration step kinds must be a non-empty unique array");
    if (step.kinds.some(kind => !allowedKinds.has(kind))) fail("Migration step kind does not belong to its domain", { domain: step.domain, kinds: step.kinds });
    validateSemver(step.from, "migration.definition.step.from");
    validateSemver(step.to, "migration.definition.step.to");
    if (compareSemver(step.to, step.from) <= 0 || compareSemver(step.to, targetSchemas[step.domain]) > 0) fail("Migration steps must move forward toward the target schema", { from: step.from, to: step.to });
    if (!Array.isArray(step.operations) || step.operations.length > MAX_OPERATIONS_PER_STEP) fail("Migration step operations exceed the limit");
    operationCount += step.operations.length;
    if (operationCount > MAX_OPERATIONS) fail("Migration definition operations exceed the total limit");
    for (const kind of step.kinds) {
      const selector = step.domain + "\0" + kind + "\0" + step.from;
      if (selectors.has(selector)) fail("Migration step selection is ambiguous", { domain: step.domain, kind, from: step.from });
      selectors.add(selector);
    }
    for (const operation of step.operations) {
      if (!operation || typeof operation !== "object" || Array.isArray(operation) || !OPERATION_FIELDS[operation.op]) fail("Migration operation is unsupported");
      rejectUnknownFields(operation, OPERATION_FIELDS[operation.op], "migration operation");
      parsePointer(operation.path);
      if ((operation.op === "add" || operation.op === "replace" || operation.op === "test") && !Object.prototype.hasOwnProperty.call(operation, "value")) {
        fail("Migration operation requires a value", { op: operation.op });
      }
    }
  }
  for (const step of definition.steps) {
    for (const kind of step.kinds) {
      const startsAtDeclaredSource = versionInRanges(step.from, definition.sources[step.domain]);
      const continuesDeclaredChain = definition.steps.some(candidate => candidate.domain === step.domain
        && candidate.kinds.includes(kind) && candidate.to === step.from);
      if (!startsAtDeclaredSource && !continuesDeclaredChain) fail("Migration step is not reachable from a declared source range", { domain: step.domain, kind, from: step.from });
    }
  }
  return clone(definition);
}

function resolveParent(document, pointer, allowAppend) {
  const segments = parsePointer(pointer);
  let parent = document;
  for (const segment of segments.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.prototype.hasOwnProperty.call(parent, segment)) fail("Migration operation path does not exist", { path: pointer });
    parent = parent[segment];
  }
  if (!parent || typeof parent !== "object") fail("Migration operation path parent is not a container", { path: pointer });
  const key = segments[segments.length - 1];
  if (Array.isArray(parent)) {
    if (key === "-" && allowAppend) return { parent, key: parent.length, exists: false };
    if (!/^(0|[1-9]\d*)$/.test(key)) fail("Migration array path must use a canonical index", { path: pointer });
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index > parent.length || (!allowAppend && index >= parent.length)) fail("Migration array index is outside bounds", { path: pointer });
    return { parent, key: index, exists: index < parent.length };
  }
  return { parent, key, exists: Object.prototype.hasOwnProperty.call(parent, key) };
}

function applyOperation(document, operation) {
  const target = resolveParent(document, operation.path, operation.op === "add");
  if (operation.op === "add") {
    if (Array.isArray(target.parent)) target.parent.splice(target.key, 0, clone(operation.value));
    else target.parent[target.key] = clone(operation.value);
    return;
  }
  if (!target.exists) fail("Migration operation path does not exist", { path: operation.path, op: operation.op });
  if (operation.op === "remove") {
    if (Array.isArray(target.parent)) target.parent.splice(target.key, 1);
    else delete target.parent[target.key];
    return;
  }
  if (operation.op === "replace") {
    target.parent[target.key] = clone(operation.value);
    return;
  }
  if (!isDeepStrictEqual(target.parent[target.key], operation.value)) {
    const error = new Error("Migration test operation did not match persisted data");
    error.code = "TARGET_MIGRATION_TEST_FAILED";
    error.details = { path: operation.path };
    throw error;
  }
}

function migrateValue(value, file, definition, targetSchemas) {
  const domain = file.kind === "config" ? "configSchema" : "stateSchema";
  const schemaField = domain === "configSchema" ? "configSchemaVersion" : "stateSchemaVersion";
  const targetVersion = targetSchemas[domain];
  const working = clone(value);
  let version = file.schemaVersion;
  const seen = new Set();
  while (version !== targetVersion) {
    if (seen.has(version)) fail("Migration chain contains a cycle", { domain, kind: file.kind, version });
    seen.add(version);
    const step = definition.steps.find(candidate => candidate.domain === domain && candidate.kinds.includes(file.kind) && candidate.from === version);
    if (!step) break;
    for (const operation of step.operations) applyOperation(working, operation);
    if (working[schemaField] !== step.to) fail("Migration step did not write its declared schema version", { schemaField, expected: step.to, actual: working[schemaField] });
    version = step.to;
  }
  return working;
}

module.exports = {
  MAX_DEFINITION_BYTES,
  migrateValue,
  validateDefinition,
};
