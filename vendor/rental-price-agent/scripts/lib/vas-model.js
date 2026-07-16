"use strict";

const VALID_PLATFORMS = new Set(["alipay", "app", "wechat", "h5", "dy", "ks", "jd"]);
const METADATA_FIELDS = ["describe", "disclaimer", "protectionScope", "claimProcess", "specialInstruction", "picDesc"];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function normalizeMetadata(source) {
  const metadata = isPlainObject(source && source.metadata) ? source.metadata : {};
  return {
    describe: String(metadata.describe ?? source?.describe ?? ""),
    disclaimer: String(metadata.disclaimer ?? source?.disclaimer ?? ""),
    protectionScope: String(metadata.protectionScope ?? source?.protection_scope ?? source?.protectionScope ?? ""),
    claimProcess: String(metadata.claimProcess ?? source?.claim_process ?? source?.claimProcess ?? ""),
    specialInstruction: String(metadata.specialInstruction ?? source?.special_intruction ?? source?.specialInstruction ?? ""),
    picDesc: String(metadata.picDesc ?? source?.pic_desc ?? source?.picDesc ?? ""),
  };
}

function normalizeCatalogService(service) {
  if (!isPlainObject(service)) return null;
  const id = String(service.id ?? service.serviceId ?? "").trim();
  if (!id) return null;
  return {
    id,
    serviceName: String(service.serviceName ?? service.service_name ?? service.name ?? ""),
    serviceMoney: String(service.serviceMoney ?? service.service_money ?? service.money ?? ""),
    metadata: normalizeMetadata(service),
  };
}

function normalizeStateService(service) {
  const catalogService = normalizeCatalogService(service);
  if (!catalogService) return null;
  return {
    ...catalogService,
    defaultSelected: service.defaultSelected === true || String(service.defaultSelected) === "1",
    isForce: service.isForce === true || String(service.isForce ?? service.is_force) === "1",
    isPopup: service.isPopup === true || String(service.isPopup ?? service.is_popup) === "1",
  };
}

function normalizeState(state) {
  const source = isPlainObject(state) ? state : {};
  return {
    enabled: source.enabled === true || String(source.enabled) === "1",
    platforms: Array.isArray(source.platforms) ? source.platforms.map(value => String(value).trim()).filter(Boolean) : [],
    services: Array.isArray(source.services) ? source.services.map(normalizeStateService).filter(Boolean) : [],
  };
}

function normalizePlanService(service, errors, path) {
  if (!isPlainObject(service)) {
    errors.push(path + " must be an object with a service id");
    return null;
  }
  const id = String(service.id ?? "").trim();
  if (!id) {
    errors.push(path + ".id is required; service names cannot be used as keys");
    return null;
  }
  const normalized = { id };
  for (const field of ["defaultSelected", "isForce", "isPopup"]) {
    if (!hasOwn(service, field)) continue;
    if (typeof service[field] !== "boolean") {
      errors.push(path + "." + field + " must be boolean");
      continue;
    }
    normalized[field] = service[field];
  }
  for (const field of ["expectedName", "expectedMoney"]) {
    if (!hasOwn(service, field)) continue;
    if (typeof service[field] !== "string") {
      errors.push(path + "." + field + " must be a string");
      continue;
    }
    normalized[field] = service[field];
  }
  if (normalized.isForce === true) {
    if (hasOwn(service, "defaultSelected") && service.defaultSelected === false) {
      errors.push(path + ": isForce=true requires defaultSelected=true");
    } else if (!hasOwn(normalized, "defaultSelected")) {
      normalized.defaultSelected = true;
    }
  }
  return normalized;
}

function findDuplicateIds(services) {
  const seen = new Set();
  const duplicates = new Set();
  for (const service of services) {
    if (seen.has(service.id)) duplicates.add(service.id);
    seen.add(service.id);
  }
  return [...duplicates];
}

function normalizeVASPlan(plan) {
  if (!isPlainObject(plan)) return {};
  const normalized = {};
  const errors = [];

  if (hasOwn(plan, "enabled")) {
    if (typeof plan.enabled !== "boolean") errors.push("VAS enabled must be boolean");
    else normalized.enabled = plan.enabled;
  }
  if (hasOwn(plan, "platforms")) {
    if (!Array.isArray(plan.platforms)) {
      errors.push("VAS platforms must be an array");
    } else {
      normalized.platforms = plan.platforms.map(value => String(value).trim()).filter(Boolean);
      const duplicatePlatforms = normalized.platforms.filter((value, index, all) => all.indexOf(value) !== index);
      if (duplicatePlatforms.length > 0) errors.push("Duplicate VAS platforms: " + [...new Set(duplicatePlatforms)].join(", "));
    }
  }

  if (hasOwn(plan, "services") && !isPlainObject(plan.services)) {
    errors.push("VAS services must be an object");
  } else if (isPlainObject(plan.services)) {
    const services = {};
    const hasSet = hasOwn(plan.services, "set");
    const hasPatch = hasOwn(plan.services, "upsert") || hasOwn(plan.services, "remove");
    if (hasSet && hasPatch) errors.push("VAS services.set cannot be combined with services.upsert/remove");

    if (hasSet) {
      if (!Array.isArray(plan.services.set)) {
        errors.push("VAS services.set must be an array");
      } else {
        services.set = plan.services.set.map((service, index) => normalizePlanService(service, errors, "services.set[" + index + "]")).filter(Boolean);
        const duplicates = findDuplicateIds(services.set);
        if (duplicates.length > 0) errors.push("Duplicate VAS service IDs in services.set: " + duplicates.join(", "));
      }
    }
    if (hasOwn(plan.services, "upsert")) {
      if (!Array.isArray(plan.services.upsert)) {
        errors.push("VAS services.upsert must be an array");
      } else {
        services.upsert = plan.services.upsert.map((service, index) => normalizePlanService(service, errors, "services.upsert[" + index + "]")).filter(Boolean);
        const duplicates = findDuplicateIds(services.upsert);
        if (duplicates.length > 0) errors.push("Duplicate VAS service IDs in services.upsert: " + duplicates.join(", "));
      }
    }
    if (hasOwn(plan.services, "remove")) {
      if (!Array.isArray(plan.services.remove)) {
        errors.push("VAS services.remove must be an array");
      } else {
        services.remove = [];
        for (let index = 0; index < plan.services.remove.length; index++) {
          const value = plan.services.remove[index];
          if (isPlainObject(value) && !hasOwn(value, "id")) {
            errors.push("services.remove[" + index + "].id is required");
            continue;
          }
          const id = String(isPlainObject(value) ? value.id ?? "" : value).trim();
          if (!id) {
            errors.push("services.remove[" + index + "] must contain a service id");
            continue;
          }
          services.remove.push(id);
        }
        const duplicateRemoves = services.remove.filter((value, index, all) => all.indexOf(value) !== index);
        if (duplicateRemoves.length > 0) errors.push("Duplicate VAS service IDs in services.remove: " + [...new Set(duplicateRemoves)].join(", "));
      }
    }
    if (services.upsert && services.remove) {
      const removed = new Set(services.remove);
      const conflicts = services.upsert.map(service => service.id).filter(id => removed.has(id));
      if (conflicts.length > 0) errors.push("VAS service IDs cannot be both upserted and removed: " + conflicts.join(", "));
    }
    normalized.services = services;
  }

  if (errors.length > 0) normalized.errors = errors;
  return normalized;
}

function hasVASOps(plan) {
  return Boolean(plan && (
    (Array.isArray(plan.errors) && plan.errors.length > 0) ||
    hasOwn(plan, "enabled") ||
    hasOwn(plan, "platforms") ||
    (isPlainObject(plan.services) && (hasOwn(plan.services, "set") || hasOwn(plan.services, "upsert") || hasOwn(plan.services, "remove")))
  ));
}

function catalogMap(catalog) {
  return new Map((Array.isArray(catalog) ? catalog : []).map(normalizeCatalogService).filter(Boolean).map(service => [service.id, service]));
}

function validateVASPlan(plan, currentState, catalog) {
  const normalized = normalizeVASPlan(plan);
  const current = normalizeState(currentState);
  const errors = [...(normalized.errors || [])];
  const warnings = [];
  const available = catalogMap(catalog);

  if (normalized.platforms) {
    for (const platform of normalized.platforms) {
      if (!VALID_PLATFORMS.has(platform)) errors.push("Invalid VAS platform: " + platform);
    }
  }

  const plannedServices = normalized.services?.set || normalized.services?.upsert || [];
  for (const service of plannedServices) {
    const found = available.get(service.id);
    if (!found) {
      errors.push("VAS service does not exist in catalog: " + service.id);
      continue;
    }
    if (hasOwn(service, "expectedName") && service.expectedName !== found.serviceName) {
      errors.push("VAS service " + service.id + " expectedName mismatch: expected " + JSON.stringify(service.expectedName) + ", catalog has " + JSON.stringify(found.serviceName));
    }
    if (hasOwn(service, "expectedMoney") && service.expectedMoney !== found.serviceMoney) {
      errors.push("VAS service " + service.id + " expectedMoney mismatch: expected " + JSON.stringify(service.expectedMoney) + ", catalog has " + JSON.stringify(found.serviceMoney));
    }
  }

  const changesServices = Boolean(normalized.services && (
    hasOwn(normalized.services, "set") ||
    (normalized.services.upsert && normalized.services.upsert.length > 0) ||
    (normalized.services.remove && normalized.services.remove.length > 0)
  ));
  if (!current.enabled && changesServices && normalized.enabled !== true) {
    errors.push("VAS service changes on a disabled product require enabled=true explicitly");
  }

  const target = buildTargetVASState(current, normalized, catalog);
  if (target.enabled && target.platforms.length === 0) errors.push("Enabled VAS requires at least one platform");
  if (target.enabled && target.services.length === 0) warnings.push("VAS is enabled with no selected services");

  const popupIds = target.services.filter(service => service.isPopup).map(service => service.id);
  if (popupIds.length > 1) errors.push("At most one VAS service may have isPopup=true: " + popupIds.join(", "));
  for (const service of target.services) {
    if (service.isForce && !service.defaultSelected) errors.push("VAS service " + service.id + ": isForce=true requires defaultSelected=true");
    if (service.isForce && service.isPopup) errors.push("VAS service " + service.id + ": isForce=true requires isPopup=false");
  }

  return { ok: errors.length === 0, errors, warnings, plan: normalized, target };
}

function materializeService(planService, existing, catalogService) {
  const source = catalogService || existing || { id: planService.id, serviceName: "", serviceMoney: "", metadata: normalizeMetadata({}) };
  return {
    id: planService.id,
    serviceName: source.serviceName,
    serviceMoney: source.serviceMoney,
    defaultSelected: hasOwn(planService, "defaultSelected") ? planService.defaultSelected : Boolean(existing && existing.defaultSelected),
    isForce: hasOwn(planService, "isForce") ? planService.isForce : Boolean(existing && existing.isForce),
    isPopup: hasOwn(planService, "isPopup") ? planService.isPopup : Boolean(existing && existing.isPopup),
    metadata: normalizeMetadata(source),
  };
}

function buildTargetVASState(currentState, plan, catalog) {
  const current = normalizeState(currentState);
  const normalized = normalizeVASPlan(plan);
  const available = catalogMap(catalog);
  const currentById = new Map(current.services.map(service => [service.id, service]));
  const target = {
    enabled: hasOwn(normalized, "enabled") ? normalized.enabled : current.enabled,
    platforms: hasOwn(normalized, "platforms") ? [...normalized.platforms] : [...current.platforms],
    services: current.services.map(service => ({ ...service, metadata: { ...service.metadata } })),
  };

  if (normalized.services && hasOwn(normalized.services, "set")) {
    target.services = normalized.services.set.map(service => materializeService(service, currentById.get(service.id), available.get(service.id)));
  } else if (normalized.services) {
    const removeIds = new Set(normalized.services.remove || []);
    target.services = target.services.filter(service => !removeIds.has(service.id));
    const indexById = new Map(target.services.map((service, index) => [service.id, index]));
    for (const service of normalized.services.upsert || []) {
      const existingIndex = indexById.get(service.id);
      const existing = existingIndex === undefined ? currentById.get(service.id) : target.services[existingIndex];
      const materialized = materializeService(service, existing, available.get(service.id));
      if (existingIndex === undefined) {
        indexById.set(service.id, target.services.length);
        target.services.push(materialized);
      } else {
        target.services[existingIndex] = materialized;
      }
    }
  }
  return target;
}

function validateVASTargetState(state) {
  const source = isPlainObject(state) ? state : {};
  const target = normalizeState(source);
  const errors = [];
  const warnings = [];

  if (!hasOwn(source, "enabled") || typeof source.enabled !== "boolean") errors.push("VAS target.enabled boolean is required");
  if (!Array.isArray(source.platforms)) errors.push("VAS target.platforms array is required");
  if (!Array.isArray(source.services)) errors.push("VAS target.services array is required");

  const rawPlatforms = Array.isArray(source.platforms) ? source.platforms : [];
  for (let index = 0; index < rawPlatforms.length; index++) {
    if (typeof rawPlatforms[index] !== "string" || rawPlatforms[index].trim() === "") {
      errors.push("VAS target.platforms[" + index + "] must be a non-empty string");
    }
  }
  for (const platform of target.platforms) {
    if (!VALID_PLATFORMS.has(platform)) errors.push("Invalid VAS platform: " + platform);
  }
  const duplicatePlatforms = target.platforms.filter((value, index, all) => all.indexOf(value) !== index);
  if (duplicatePlatforms.length > 0) errors.push("Duplicate VAS platforms: " + [...new Set(duplicatePlatforms)].join(", "));

  const rawServices = Array.isArray(source.services) ? source.services : [];
  if (rawServices.length !== target.services.length) errors.push("VAS target contains a service without a valid id");
  for (let index = 0; index < rawServices.length; index++) {
    const service = rawServices[index];
    if (!isPlainObject(service)) {
      errors.push("VAS target.services[" + index + "] must be an object");
      continue;
    }
    if (typeof service.id !== "string" || service.id.trim() === "") errors.push("VAS target.services[" + index + "].id non-empty string is required");
    for (const field of ["serviceName", "serviceMoney"]) {
      if (typeof service[field] !== "string") errors.push("VAS target.services[" + index + "]." + field + " string is required");
    }
    for (const field of ["defaultSelected", "isForce", "isPopup"]) {
      if (typeof service[field] !== "boolean") errors.push("VAS target.services[" + index + "]." + field + " boolean is required");
    }
    if (!isPlainObject(service.metadata)) {
      errors.push("VAS target.services[" + index + "].metadata object is required");
    } else {
      for (const field of METADATA_FIELDS) {
        if (typeof service.metadata[field] !== "string") errors.push("VAS target.services[" + index + "].metadata." + field + " string is required");
      }
    }
  }
  const duplicateIds = findDuplicateIds(target.services);
  if (duplicateIds.length > 0) errors.push("Duplicate VAS service IDs in target state: " + duplicateIds.join(", "));
  if (target.enabled && target.platforms.length === 0) errors.push("Enabled VAS requires at least one platform");
  if (target.enabled && target.services.length === 0) warnings.push("VAS is enabled with no selected services");

  const popupIds = target.services.filter(service => service.isPopup).map(service => service.id);
  if (popupIds.length > 1) errors.push("At most one VAS service may have isPopup=true: " + popupIds.join(", "));
  for (const service of target.services) {
    if (service.isForce && !service.defaultSelected) errors.push("VAS service " + service.id + ": isForce=true requires defaultSelected=true");
    if (service.isForce && service.isPopup) errors.push("VAS service " + service.id + ": isForce=true requires isPopup=false");
  }

  return { ok: errors.length === 0, errors, warnings, target };
}

function compareVASState(actual, expected) {
  const left = normalizeState(actual);
  const right = normalizeState(expected);
  const checks = [];
  checks.push({ field: "enabled", expected: right.enabled, actual: left.enabled, match: left.enabled === right.enabled });
  const leftPlatforms = [...new Set(left.platforms)].sort();
  const rightPlatforms = [...new Set(right.platforms)].sort();
  checks.push({ field: "platforms", expected: rightPlatforms, actual: leftPlatforms, match: JSON.stringify(leftPlatforms) === JSON.stringify(rightPlatforms) });
  checks.push({ field: "serviceIds", expected: right.services.map(service => service.id), actual: left.services.map(service => service.id), match: JSON.stringify(left.services.map(service => service.id)) === JSON.stringify(right.services.map(service => service.id)) });

  const max = Math.max(left.services.length, right.services.length);
  for (let index = 0; index < max; index++) {
    const actualService = left.services[index];
    const expectedService = right.services[index];
    const id = expectedService?.id || actualService?.id || String(index);
    for (const field of ["serviceName", "serviceMoney", "defaultSelected", "isForce", "isPopup"]) {
      const actualValue = actualService && actualService[field];
      const expectedValue = expectedService && expectedService[field];
      checks.push({ field: "services[" + index + "]." + field, serviceId: id, expected: expectedValue, actual: actualValue, match: actualValue === expectedValue });
    }
    for (const field of METADATA_FIELDS) {
      const actualValue = actualService && actualService.metadata && actualService.metadata[field];
      const expectedValue = expectedService && expectedService.metadata && expectedService.metadata[field];
      checks.push({ field: "services[" + index + "].metadata." + field, serviceId: id, expected: expectedValue, actual: actualValue, match: actualValue === expectedValue });
    }
  }
  const mismatches = checks.filter(check => !check.match);
  return {
    match: mismatches.length === 0,
    total: checks.length,
    matched: checks.length - mismatches.length,
    mismatched: mismatches.length,
    checks,
    mismatches,
  };
}

function serviceSummary(service) {
  if (!service) return "(not selected)";
  const metadata = METADATA_FIELDS.map(field => field + "=" + JSON.stringify(service.metadata?.[field] || "")).join(" / ");
  return service.serviceName + " / " + service.serviceMoney + " / default=" + service.defaultSelected + " / force=" + service.isForce + " / popup=" + service.isPopup + " / " + metadata;
}

function buildVASDiff(currentState, targetState) {
  const current = normalizeState(currentState);
  const target = normalizeState(targetState);
  const diff = [];
  if (current.enabled !== target.enabled) {
    diff.push({ specId: "(vas)", field: "enabled", old: String(current.enabled), new: String(target.enabled), change: "VAS", status: "ok", scope: "vas" });
  }
  const currentPlatforms = [...new Set(current.platforms)].sort();
  const targetPlatforms = [...new Set(target.platforms)].sort();
  if (JSON.stringify(currentPlatforms) !== JSON.stringify(targetPlatforms)) {
    diff.push({ specId: "(vas)", field: "platforms", old: currentPlatforms.join(","), new: targetPlatforms.join(","), change: "VAS", status: "ok", scope: "vas" });
  }

  const currentById = new Map(current.services.map((service, index) => [service.id, { service, index }]));
  const targetById = new Map(target.services.map((service, index) => [service.id, { service, index }]));
  for (const { service, index } of currentById.values()) {
    if (!targetById.has(service.id)) {
      diff.push({ specId: "(vas:" + service.id + ")", field: "service", old: serviceSummary(service), new: "(not selected)", operation: "remove", change: "VAS", status: "ok", scope: "vas", oldIndex: index });
    }
  }
  for (const { service, index } of targetById.values()) {
    const before = currentById.get(service.id);
    if (!before) {
      diff.push({ specId: "(vas:" + service.id + ")", field: "service", old: "(not selected)", new: serviceSummary(service), operation: "add", change: "VAS", status: "ok", scope: "vas", newIndex: index });
      continue;
    }
    const changed = before.index !== index ||
      ["serviceName", "serviceMoney", "defaultSelected", "isForce", "isPopup"].some(field => before.service[field] !== service[field]) ||
      METADATA_FIELDS.some(field => before.service.metadata?.[field] !== service.metadata?.[field]);
    if (changed) {
      diff.push({ specId: "(vas:" + service.id + ")", field: "service", old: serviceSummary(before.service), new: serviceSummary(service), operation: before.index !== index ? "reorder_or_update" : "update", change: "VAS", status: "ok", scope: "vas", oldIndex: before.index, newIndex: index });
    }
  }
  return diff;
}

module.exports = {
  VALID_PLATFORMS,
  METADATA_FIELDS,
  normalizeVASPlan,
  hasVASOps,
  validateVASPlan,
  buildTargetVASState,
  validateVASTargetState,
  compareVASState,
  buildVASDiff,
};
