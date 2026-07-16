const fs = require("fs");
const path = require("path");

const { ACTION_REGISTRY, classifyAction } = require("./action-registry");

function guardActive() {
  return process.env.LIFECYCLE_TEST_GUARD === "1";
}

function recordEvent(type, detail = {}) {
  if (!guardActive()) return;
  const filePath = process.env.LIFECYCLE_TEST_EVIDENCE_PATH;
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify({ type, pid: process.pid, ...detail }) + "\n", "utf8");
}

function classifyInvocation(action, registry = ACTION_REGISTRY) {
  const decision = classifyAction(action, registry);
  return {
    action: decision.action,
    classification: decision.classification,
    counted: decision.allowed && decision.classification === "mutation",
    allowed: decision.allowed,
  };
}

function recordActionAttempt(action, options = {}) {
  const decision = classifyInvocation(action, options.registry || ACTION_REGISTRY);
  if (!decision.allowed) return decision;
  if (options.counters) {
    options.counters.actionAttempts = (options.counters.actionAttempts || 0) + 1;
    if (decision.counted) options.counters.mutationAttempts = (options.counters.mutationAttempts || 0) + 1;
  }
  recordEvent("action-attempt", decision);
  return decision;
}

async function invokeAction(action, handler, options = {}) {
  const decision = classifyInvocation(action, options.registry || ACTION_REGISTRY);
  if (!decision.allowed) return handler();
  if (options.counters) {
    options.counters.handlerInvocations = (options.counters.handlerInvocations || 0) + 1;
    if (decision.counted) options.counters.mutationInvocations = (options.counters.mutationInvocations || 0) + 1;
  }
  recordEvent("handler-invocation", decision);
  const result = await handler();
  if (!result || result.status !== "error") {
    if (options.counters) options.counters.successfulHandlerInvocations = (options.counters.successfulHandlerInvocations || 0) + 1;
    recordEvent("handler-success", decision);
  }
  return result;
}

module.exports = {
  classifyInvocation,
  guardActive,
  invokeAction,
  recordActionAttempt,
  recordEvent,
};
