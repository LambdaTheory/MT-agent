#!/usr/bin/env node

const assert = require("assert");
const { EventEmitter } = require("events");
const path = require("path");
const fs = require("fs");
const os = require("os");

const batchRunner = require("./batch-runner.js");
const pwRunner = require("./playwright-runner.js");
const mirrorSearch = require("./mirror-search.js");
const vasModel = require("./lib/vas-model.js");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function makeManualTimers() {
  const entries = [];
  return {
    api: {
      setTimeout(fn, delay) {
        const entry = { fn, delay, active: true };
        entries.push(entry);
        return entry;
      },
      clearTimeout(entry) {
        if (entry) entry.active = false;
      },
    },
    activeDelays() {
      return entries.filter(entry => entry.active).map(entry => entry.delay);
    },
    run(delay) {
      const entry = entries.find(candidate => candidate.active && candidate.delay === delay);
      assert.ok(entry, "expected active timer with delay " + delay + ", got " + this.activeDelays().join(","));
      entry.active = false;
      entry.fn();
    },
  };
}

function fakeSubmitResponse(bodyPromise, overrides = {}) {
  const request = overrides.request || { method: () => overrides.method || "POST" };
  return {
    url: () => overrides.url || "https://example.test/web/index.php?r=goods.edit&id=761",
    request: () => request,
    status: () => overrides.httpStatus || 200,
    headers: () => ({ "content-type": overrides.contentType || "application/json" }),
    text: async () => bodyPromise,
  };
}

function extractActiveExampleText(text, extension) {
  if (extension === ".md") {
    const fenced = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]);
    const inlineJson = [...text.matchAll(/`(\{[^`]*(?:"action"|"productId")[^`]*\})`/g)].map(match => match[1]);
    return fenced.concat(inlineJson).join("\n");
  }
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function makeFakeTab({ url = "https://example.test/web/index.php?c=site&a=entry&m=ewei_shopv2&do=web&r=goods.edit&id=761", redirectUrl = "", specs = [], elements = {}, rentFields = {} } = {}) {
  let currentUrl = url;
  return {
    async goto(targetUrl) { currentUrl = redirectUrl || targetUrl; },
    async waitForTimeout() {},
    url() { return currentUrl; },
    async evaluate(fn, params) {
      // Rent field discovery receives params with specId
      if (params && params.specId !== undefined) {
        return rentFields[String(params.specId)] || {};
      }
      // Specs discovery (no params)
      const src = String(fn);
      if (src.includes("#options table tbody tr")) {
        return specs;
      }
      throw new Error("Unexpected evaluate call in fake tab");
    },
    async $(selector) {
      if (!(selector in elements)) return null;
      const entry = elements[selector];
      if (entry === null) return null;
      return {
        async inputValue() {
          if (entry.throwInputValue) throw new Error(entry.throwInputValue);
          return entry.value;
        },
        async textContent() {
          return entry.value;
        },
        async evaluate(fn) {
          const src = String(fn);
          if (src.includes("tagName.toLowerCase")) return entry.tag || "input";
          if (entry.tag === "select" && src.includes("selectedIndex")) return entry.value;
          return entry.value;
        },
      };
    },
  };
}

const vasCatalog = [
  { id: "1", service_name: "安心保", service_money: "20.00", describe: "A" },
  { id: "2", service_name: "安心保", service_money: "30.00", describe: "B" },
  { id: "8", service_name: "拍立得相纸10张", service_money: "70.00" },
];

const vasCurrent = {
  enabled: true,
  platforms: ["wechat", "h5"],
  services: [
    { id: "1", serviceName: "安心保", serviceMoney: "20.00", defaultSelected: false, isForce: false, isPopup: false, metadata: { describe: "A", disclaimer: "", protectionScope: "", claimProcess: "", specialInstruction: "", picDesc: "" } },
    { id: "8", serviceName: "拍立得相纸10张", serviceMoney: "70.00", defaultSelected: false, isForce: false, isPopup: false, metadata: { describe: "", disclaimer: "", protectionScope: "", claimProcess: "", specialInstruction: "", picDesc: "" } },
  ],
};

function assertValidationError(plan, pattern, current = vasCurrent, catalog = vasCatalog) {
  const result = vasModel.validateVASPlan(vasModel.normalizeVASPlan(plan), current, catalog);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(message => pattern.test(message)), JSON.stringify(result.errors));
}

test("normalizeVASPlan 阻止 services.set 与 patch 冲突", () => {
  const plan = vasModel.normalizeVASPlan({ services: { set: [{ id: "1" }], remove: ["2"] } });
  assert.ok(plan.errors.some(message => /cannot be combined/.test(message)));
});

test("normalizeVASPlan 拒绝类型错误，不把它们静默变成 false 或空数组", () => {
  const plan = vasModel.normalizeVASPlan({
    enabled: "true",
    platforms: "wechat",
    services: { set: {}, upsert: "bad", remove: { id: "1" } },
  });
  assert.ok(plan.errors.some(message => /enabled must be boolean/.test(message)));
  assert.ok(plan.errors.some(message => /platforms must be an array/.test(message)));
  assert.ok(plan.errors.some(message => /services\.set must be an array/.test(message)));
  assert.ok(plan.errors.some(message => /services\.upsert must be an array/.test(message)));
  assert.ok(plan.errors.some(message => /services\.remove must be an array/.test(message)));
  assert.equal(plan.enabled, undefined);
  assert.equal(plan.platforms, undefined);
});

test("normalizeVASPlan 拒绝服务布尔选项的字符串伪值", () => {
  const plan = vasModel.normalizeVASPlan({ services: { set: [{ id: "1", defaultSelected: "true", isForce: 1, isPopup: null }] } });
  assert.ok(plan.errors.some(message => /defaultSelected must be boolean/.test(message)));
  assert.ok(plan.errors.some(message => /isForce must be boolean/.test(message)));
  assert.ok(plan.errors.some(message => /isPopup must be boolean/.test(message)));
  assert.equal(plan.services.set[0].defaultSelected, undefined);
});

test("validateVASPlan 阻止非法平台", () => {
  assertValidationError({ platforms: ["wechat", "desktop"] }, /Invalid VAS platform/);
});

test("VAS 同名服务严格按 ID 定位", () => {
  const target = vasModel.buildTargetVASState(vasCurrent, vasModel.normalizeVASPlan({ services: { set: [{ id: "2" }] } }), vasCatalog);
  assert.equal(target.services[0].id, "2");
  assert.equal(target.services[0].serviceName, "安心保");
  assert.equal(target.services[0].serviceMoney, "30.00");
});

test("VAS upsert/remove 构建幂等目标", () => {
  const plan = vasModel.normalizeVASPlan({ services: { upsert: [{ id: "1", isPopup: true }, { id: "2" }], remove: ["8"] } });
  const once = vasModel.buildTargetVASState(vasCurrent, plan, vasCatalog);
  const twice = vasModel.buildTargetVASState(once, plan, vasCatalog);
  assert.deepEqual(twice, once);
  assert.deepEqual(once.services.map(service => service.id), ["1", "2"]);
});

test("validateVASPlan 阻止多个 isPopup", () => {
  assertValidationError({ services: { set: [{ id: "1", isPopup: true }, { id: "8", isPopup: true }] } }, /At most one/);
});

test("normalizeVASPlan 为 force 推导 defaultSelected", () => {
  const plan = vasModel.normalizeVASPlan({ services: { set: [{ id: "1", isForce: true }] } });
  assert.equal(plan.services.set[0].defaultSelected, true);
});

test("validateVASPlan 阻止 force 与显式 default false", () => {
  assertValidationError({ services: { set: [{ id: "1", isForce: true, defaultSelected: false }] } }, /requires defaultSelected=true/);
});

test("validateVASPlan 阻止 force 与 popup 同时开启", () => {
  assertValidationError({ services: { set: [{ id: "1", isForce: true, isPopup: true }] } }, /requires isPopup=false/);
});

test("validateVASPlan 阻止 expectedName 和 expectedMoney 不匹配", () => {
  const result = vasModel.validateVASPlan(
    vasModel.normalizeVASPlan({ services: { set: [{ id: "1", expectedName: "错误名称", expectedMoney: "99.00" }] } }),
    vasCurrent,
    vasCatalog
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(message => /expectedName mismatch/.test(message)));
  assert.ok(result.errors.some(message => /expectedMoney mismatch/.test(message)));
});

test("compareVASState 平台无序但服务和元数据精确比较", () => {
  const same = vasModel.compareVASState({ ...vasCurrent, platforms: ["h5", "wechat"] }, vasCurrent);
  assert.equal(same.match, true);
  const reordered = vasModel.compareVASState({ ...vasCurrent, services: [...vasCurrent.services].reverse() }, vasCurrent);
  assert.equal(reordered.match, false);
  assert.ok(reordered.mismatches.some(item => item.field === "serviceIds"));
  const metadataChanged = JSON.parse(JSON.stringify(vasCurrent));
  metadataChanged.services[0].metadata.describe = "changed";
  const metadataResult = vasModel.compareVASState(metadataChanged, vasCurrent);
  assert.equal(metadataResult.match, false);
  assert.ok(metadataResult.mismatches.some(item => item.field === "services[0].metadata.describe"));
});

test("validateVASTargetState 校验完整快照约束", () => {
  const valid = vasModel.validateVASTargetState(vasCurrent);
  assert.equal(valid.ok, true);
  const missing = vasModel.validateVASTargetState({});
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some(message => /target.enabled/.test(message)));
  assert.ok(missing.errors.some(message => /target.platforms/.test(message)));
  assert.ok(missing.errors.some(message => /target.services/.test(message)));
  const invalid = vasModel.validateVASTargetState({ enabled: true, platforms: [], services: [{ ...vasCurrent.services[0], isForce: true, defaultSelected: false }] });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(message => /requires at least one platform/.test(message)));
  assert.ok(invalid.errors.some(message => /requires defaultSelected=true/.test(message)));
  const partialService = vasModel.validateVASTargetState({ enabled: false, platforms: [], services: [{ id: "1" }] });
  assert.equal(partialService.ok, false);
  assert.ok(partialService.errors.some(message => /serviceName string is required/.test(message)));
  assert.ok(partialService.errors.some(message => /metadata object is required/.test(message)));
});

test("buildRollbackItem 仅回滚实际变化字段并保留完整 VAS 快照", () => {
  const vasBefore = JSON.parse(JSON.stringify(vasCurrent));
  const item = batchRunner.buildRollbackItem({
    productId: 761,
    currentValues: { "3862": { rent1day: "22.00", rent45day: "399.00", stock: "5", finalPayment: "0.00", ignored: "x" } },
    finalValues: { "3862": { rent1day: "22.00", rent45day: "450.00", stock: "6", finalPayment: "0.00" } },
    vasBefore,
  });
  assert.deepEqual(item.vasSnapshot, vasBefore);
  assert.equal(item.vas, undefined);
  assert.equal(item.fields["3862"].rent45day, "399.00");
  assert.equal(item.fields["3862"].stock, "5");
  assert.equal(item.fields["3862"].rent1day, undefined);
  assert.equal(item.fields["3862"].finalPayment, undefined);
  assert.equal(item.fields["3862"].ignored, undefined);
});

test("回滚候选排除 skipSubmit 的 preview_only 项", () => {
  const committed = { productId: 761, status: "ok", currentValues: { "1": { rent1day: "10" } }, finalValues: { "1": { rent1day: "11" } } };
  const previewOnly = { productId: 762, status: "preview_only", currentValues: { "1": { rent1day: "20" } } };
  const verifyFailed = { productId: 763, status: "verify_failed", currentValues: { "1": { rent1day: "30" } }, finalValues: { "1": { rent1day: "31" } } };
  const candidates = batchRunner.getRollbackCandidates({ completed: [committed, previewOnly], verifyFailed: [verifyFailed] });
  assert.deepEqual(candidates.map(entry => entry.productId), [761, 763]);
  assert.deepEqual(batchRunner.getCommittedEntries({ completed: [committed, previewOnly] }).map(entry => entry.productId), [761]);
});

test("buildRollbackItem 在仅 VAS 回滚时不生成字段回滚", () => {
  const item = batchRunner.buildRollbackItem({
    productId: 761,
    currentValues: { "3862": { stock: "5", finalPayment: "0.00" } },
    finalValues: { "3862": { stock: "5", finalPayment: "0.00" } },
    vasBefore: { enabled: false, platforms: ["wechat"], services: [] },
  });
  assert.equal(item.productId, 761);
  assert.equal(item.fields, undefined);
  assert.deepEqual(item.vasSnapshot, { enabled: false, platforms: ["wechat"], services: [] });
});

test("buildVASDiff 输出开关、平台和服务变更", () => {
  const target = vasModel.buildTargetVASState(vasCurrent, vasModel.normalizeVASPlan({ enabled: false, platforms: ["app"], services: { set: [{ id: "2", defaultSelected: true }] } }), vasCatalog);
  const diff = vasModel.buildVASDiff(vasCurrent, target);
  assert.ok(diff.some(item => item.field === "enabled"));
  assert.ok(diff.some(item => item.field === "platforms"));
  assert.ok(diff.some(item => item.operation === "remove"));
  assert.ok(diff.some(item => item.operation === "add"));
});

test("buildVASDiff 显示纯服务元数据变化", () => {
  const target = JSON.parse(JSON.stringify(vasCurrent));
  target.services[0].metadata.disclaimer = "服务条款已更新";
  const diff = vasModel.buildVASDiff(vasCurrent, target);
  const update = diff.find(item => item.specId === "(vas:1)");
  assert.ok(update);
  assert.equal(update.operation, "update");
  assert.match(update.new, /服务条款已更新/);
});

test("normalizeBatchItem 包含正式 vas 与兼容别名", () => {
  const formal = batchRunner.normalizeBatchItem({ items: [] }, { productId: 761, vas: { enabled: true } });
  assert.equal(formal.vas.enabled, true);
  const alias = batchRunner.normalizeBatchItem({ items: [] }, { productId: 761, valueAddedServices: { enabled: false } });
  assert.equal(alias.vas.enabled, false);
});

test("normalizeImagePlan 规范化图片计划并阻止冲突字段", () => {
  const plan = batchRunner.normalizeImagePlan({
    pick: { category: "产品图", files: ["a.jpg", " b.jpg "], skipIfAlreadyPresent: true },
    upload: { sectionType: "white", categoryName: "白底", path: "D:/tmp/demo.png", allowDuplicateFileName: true },
    whiteImage: { category: "白底", name: "white.png", skipIfWhiteImageMatched: true },
    orderedUrls: [" https://a/1.png "],
    thumbnailFileName: "cover.png",
  });
  assert.equal(plan.pick.categoryName, "产品图");
  assert.deepEqual(plan.pick.fileNames, ["a.jpg", "b.jpg"]);
  assert.equal(plan.pick.skipIfAlreadyPresent, true);
  assert.equal(plan.upload.sectionType, "white");
  assert.equal(plan.upload.uploadFile, "D:/tmp/demo.png");
  assert.equal(plan.upload.allowDuplicateFileName, true);
  assert.equal(plan.whiteImage.fileName, "white.png");
  assert.equal(plan.whiteImage.skipIfWhiteImageMatched, true);
  assert.equal(plan.invalid, "orderedUrls and thumbnailFileName cannot be used together");
});

test("validateBatchSize 按 config.rules.maxBatchSize 拦截超限批次", () => {
  const ok = batchRunner.validateBatchSize({ items: [{ productId: 1 }, { productId: 2 }] }, { maxBatchSize: 2 });
  assert.equal(ok.ok, true);
  const bad = batchRunner.validateBatchSize({ items: [{ productId: 1 }, { productId: 2 }, { productId: 3 }] }, { maxBatchSize: 2 });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /exceeds config\.rules\.maxBatchSize=2/);
});

test("validateBatchItems 拒绝重复或非规范 productId", () => {
  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: 761, fields: { stock: "5" } }, { productId: "761", fields: { stock: "6" } }] }).ok, false);
  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: "0761", fields: { stock: "5" } }] }).ok, false);
  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: 0, fields: { stock: "5" } }] }).ok, false);
  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: 761, fields: { stock: "5" } }, { productId: 762, fields: { stock: "6" } }] }).ok, true);
});

test("validateBatchItems 拒绝 no-op 但接受 shared setup 生效项", () => {
  assert.equal(batchRunner.validateBatchItems({ items: [{ productId: 761 }] }).ok, false);
  assert.equal(batchRunner.validateBatchItems({ shared: { tenancySet: "1,10,30" }, items: [{ productId: 761 }] }).ok, true);
});

test("compareImageState 比较 thumbs、thumbnail、white", () => {
  pwRunner.__setConfigForTest({ saas: { baseUrl: "https://example.com" } });
  const actual = {
    thumbs: { values: ["/img/a.png", "https://zloss.xinyongzu.cn/img/b.png"] },
    thumbnail: "/img/a.png",
    white: { value: "/white/c.png" },
  };
  const expected = {
    thumbs: ["https://example.com/img/a.png", "https://zloss.xinyongzu.cn/img/b.png"],
    thumbnail: "https://example.com/img/a.png",
    white: "https://example.com/white/c.png",
  };
  const result = pwRunner.compareImageState(actual, expected);
  assert.equal(result.mismatched, 0);
  assert.equal(result.total, 3);
});

test("isSubmitSuccessText 只接受成功语义文本", () => {
  assert.equal(pwRunner.isSubmitSuccessText(" 保存成功 "), true);
  assert.equal(pwRunner.isSubmitSuccessText("operation success"), true);
  assert.equal(pwRunner.isSubmitSuccessText("修改成功"), true);
  assert.equal(pwRunner.isSubmitSuccessText("更新成功"), true);
  assert.equal(pwRunner.isSubmitSuccessText("编辑成功"), true);
  assert.equal(pwRunner.isSubmitSuccessText("保存失败，请重试"), false);
  assert.equal(pwRunner.isSubmitSuccessText("修改成功但保存失败"), false);
  assert.equal(pwRunner.isSubmitSuccessText("知道了"), false);
});

test("classifySubmitResponseEvidence 仅匹配当前商品 goods.edit POST 并保守分类", () => {
  const options = {
    pageUrl: "https://example.test/web/index.php?c=site&a=entry&m=ewei_shopv2&do=web&r=goods.edit&id=761",
    expectedProductId: "761",
  };
  const base = {
    url: options.pageUrl,
    method: "POST",
    httpStatus: 200,
    contentType: "application/json; charset=utf-8",
    bodyText: "",
  };
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, method: "GET", bodyText: '{"success":true}' }, options).status, "ignored");
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, url: base.url.replace("id=761", "id=762"), bodyText: '{"success":true}' }, options).status, "ignored");
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, httpStatus: 500, bodyText: '{"success":true}' }, options).status, "error");
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, bodyText: "" }, options).status, "unknown");
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, httpStatus: 204 }, options).status, "unknown");
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, contentType: "text/html", bodyText: "<html>保存成功</html>" }, options).status, "unknown");
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, bodyText: "not-json" }, options).status, "unknown");
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, bodyText: '{"success":true,"message":"保存失败"}' }, options).status, "error");
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, bodyText: '{"success":true,"message":"修改成功"}' }, options).status, "ok");
  assert.equal(pwRunner.classifySubmitResponseEvidence({ ...base, contentType: "text/plain", bodyText: "更新成功" }, options).status, "ok");
  const bounded = pwRunner.classifySubmitResponseEvidence({ ...base, contentType: "text/plain", bodyText: "x".repeat(2000) }, options);
  assert.ok(bounded.bodyPreview.length <= 500);
});

test("classifySubmitResponseEvidence 支持 ewei status/code=1 并让嵌套失败消息优先", () => {
  const options = { pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761", expectedProductId: "761" };
  const classify = bodyText => pwRunner.classifySubmitResponseEvidence({
    url: options.pageUrl,
    method: "POST",
    httpStatus: 200,
    contentType: "application/json",
    bodyText,
  }, options).status;
  assert.equal(classify('{"status":1}'), "ok");
  assert.equal(classify('{"status":"1"}'), "ok");
  assert.equal(classify('{"code":1}'), "ok");
  assert.equal(classify('{"code":"1"}'), "ok");
  assert.equal(classify('{"status":0}'), "error");
  assert.equal(classify('{"status":1,"result":{"message":"保存失败"}}'), "error");
  assert.equal(classify('{"code":"1","data":{"msg":"更新错误"}}'), "error");
  assert.equal(classify('{"code":2}'), "unknown");
  assert.equal(classify('{"code":0}'), "unknown");
  assert.equal(classify('{"code":200}'), "unknown");
  assert.equal(classify('{"code":0,"result":{"message":"保存失败"}}'), "error");
  assert.equal(classify('{"code":1,"data":{"success":false,"error":"save rejected"}}'), "error");
  assert.equal(classify('{"code":1,"data":{"result":{"status":0,"message":"save rejected"}}}'), "error");
});

test("classifySubmitResponseEvidence 截断遍历时不接受成功标记", () => {
  const options = { pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761", expectedProductId: "761" };
  const classify = body => pwRunner.classifySubmitResponseEvidence({
    url: options.pageUrl,
    method: "POST",
    httpStatus: 200,
    contentType: "application/json",
    bodyText: JSON.stringify(body),
  }, options);
  const failureBeyondCap = Array.from({ length: 205 }, (_, index) => index === 0
    ? { message: "保存失败" }
    : { value: index });
  const hiddenFailure = classify({ success: true, data: failureBeyondCap });
  assert.equal(hiddenFailure.status, "unknown");
  assert.equal(hiddenFailure.detail, "inspection_truncated");

  const truncatedSuccess = classify({ success: true, data: Array.from({ length: 205 }, (_, index) => ({ value: index })) });
  assert.equal(truncatedSuccess.status, "unknown");
  assert.equal(truncatedSuccess.detail, "inspection_truncated");
});

test("submit evidence previews redact nested JSON, text credentials, and URL query secrets", () => {
  const pageUrl = "https://example.test/web/index.php?r=goods.edit&id=761";
  const classified = pwRunner.classifySubmitResponseEvidence({
    url: pageUrl + "&token=url-secret&safe=kept",
    method: "POST",
    httpStatus: 200,
    contentType: "application/json",
    bodyText: JSON.stringify({
      status: 1,
      message: "saved",
      data: { password: "json-secret", authorization: "Bearer bearer-secret", note: "kept" },
    }),
  }, { pageUrl, expectedProductId: "761" });
  assert.equal(classified.status, "ok");
  assert.match(classified.bodyPreview, /saved/);
  assert.match(classified.bodyPreview, /kept/);
  assert.doesNotMatch(classified.bodyPreview, /json-secret|bearer-secret/);
  assert.match(classified.url, /safe=kept/);
  assert.doesNotMatch(classified.url, /url-secret/);

  const text = pwRunner.redactPreview("status=ok message=saved password=text-secret Authorization: Bearer auth-secret Cookie: sid=cookie-secret");
  assert.match(text, /status=ok/);
  assert.match(text, /message=saved/);
  assert.doesNotMatch(text, /text-secret|auth-secret|cookie-secret/);
  assert.ok(text.length <= 500);
});

test("playwright 与 batch previews redact camelCase secret keys", () => {
  const secretKeys = ["accessToken", "refreshToken", "clientSecret", "apiKey", "sessionId", "authToken"];
  const payload = Object.fromEntries(secretKeys.map((key, index) => [key, "json-secret-" + index]));
  const plainText = secretKeys.map((key, index) => key + (index % 2 === 0 ? "=" : ": ") + "text-secret-" + index).join(" ");
  for (const redact of [pwRunner.redactPreview, batchRunner.redactPreview]) {
    const jsonPreview = redact(payload);
    const textPreview = redact(plainText);
    assert.doesNotMatch(jsonPreview, /json-secret-/);
    assert.doesNotMatch(textPreview, /text-secret-/);
  }
});

test("post-navigation product validation rejects wrong product and route", () => {
  const template = "https://example.test/web/index.php?r=goods.edit&id={productId}";
  const wrongProduct = pwRunner.validateProductPageAfterNavigation(
    "https://example.test/web/index.php?r=goods.edit&id=762",
    "761",
    template,
    false
  );
  assert.equal(wrongProduct.status, "error");
  assert.equal(wrongProduct.currentProductId, "762");

  const wrongRoute = pwRunner.validateProductPageAfterNavigation(
    "https://example.test/web/index.php?r=goods.list&id=761",
    "761",
    template,
    false
  );
  assert.equal(wrongRoute.status, "error");
});

test("actionNavigate rejects a redirect to the wrong product before reporting success", async () => {
  let currentUrl = "https://example.test/web/index.php?r=goods.edit&id=762";
  pwRunner.__setConfigForTest({
    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
  });
  pwRunner.__setPageForTest({
    async goto() {},
    url() { return currentUrl; },
  });
  const result = await pwRunner.actionNavigate("761");
  assert.equal(result.status, "error");
  assert.equal(result.currentProductId, "762");
});

test("actionVASApply rejects failed readback even when an empty disabled target would compare equal", async () => {
  let evaluateCount = 0;
  const target = { enabled: false, platforms: [], services: [] };
  pwRunner.__setConfigForTest({
    saas: {
      baseUrl: "https://example.test",
      productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}",
    },
    selectors: { vas: {} },
  });
  pwRunner.__setPageForTest({
    url() { return "https://example.test/web/index.php?r=goods.edit&id=761"; },
    async waitForTimeout() {},
    async evaluate() {
      evaluateCount++;
      if (evaluateCount === 1) return { ok: true, optionResults: [] };
      return { ok: false, missing: ["enabledRadio", "platformCheckbox", "list"] };
    },
  });
  const result = await pwRunner.actionVASApply("761", target, true, "761");
  assert.equal(result.status, "error");
  assert.deepEqual(result.missing, ["enabledRadio", "platformCheckbox", "list"]);
});

test("actionLogin rejects a cross-origin redirect before filling credentials", async () => {
  let filled = false;
  pwRunner.__setConfigForTest({
    saas: {
      loginUrl: "https://trusted.example/web/index.php?c=user&a=login",
      credentials: { username: "user", password: "secret" },
    },
    selectors: { login: { username: "#user", password: "#pass", submitButton: "#submit" } },
  });
  pwRunner.__setPageForTest({
    async goto() {},
    url() { return "https://attacker.example/login"; },
    async $() { return {}; },
    async fill() { filled = true; },
    async click() {},
  });
  const result = await pwRunner.actionLogin();
  assert.equal(result.status, "error");
  assert.equal(filled, false);
});

test("copy destination validation rejects deceptive cross-origin edit routes", () => {
  assert.equal(typeof pwRunner.validateCopyDestination, "function");
  const result = pwRunner.validateCopyDestination(
    "https://attacker.example/web/index.php?r=goods.edit&id=761",
    "761",
    "https://trusted.example/web/index.php?r=goods.edit&id={productId}"
  );
  assert.equal(result.ok, false);
});

test("actionBatchRead converts newPage failure into a structured batch error", async () => {
  pwRunner.__setConfigForTest({
    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
    selectors: { product: {} },
  });
  pwRunner.__setContextForTest({
    async newPage() { throw new Error("page creation failed"); },
  });
  const result = await pwRunner.actionBatchRead(["761"], []);
  assert.equal(result.status, "error");
  assert.deepEqual(result.errors, [{ productId: "761", error: "page creation failed" }]);
});

test("legacy login propagates an untrusted-origin login failure", async () => {
  pwRunner.__setConfigForTest({
    saas: { loginUrl: "https://trusted.example/login", credentials: { username: "user", password: "secret" } },
    selectors: { login: { username: "#user", password: "#pass", submitButton: "#submit" } },
  });
  pwRunner.__setPageForTest({
    async goto() {},
    url() { return "https://attacker.example/login"; },
  });
  const result = await pwRunner.handleLegacyAction("login", []);
  assert.equal(result.status, "error");
  assert.match(result.message, /untrusted origin/);
});

test("findProductOnList stops before DOM access when login origin validation fails", async () => {
  let queried = false;
  pwRunner.__setConfigForTest({
    saas: {
      loginUrl: "https://trusted.example/login",
      productListUrl: "https://trusted.example/web/index.php?r=goods.list",
    },
  });
  pwRunner.__setPageForTest({
    async goto() {},
    url() { return "https://attacker.example/web/index.php?r=goods.list"; },
    async waitForTimeout() {},
    async $() { queried = true; return null; },
  });
  const result = await pwRunner.findProductOnList("761");
  assert.equal(result.status, "error");
  assert.equal(queried, false);
});

test("findProductOnList revalidates the list page after keyword search navigation", async () => {
  let currentUrl = "https://trusted.example/web/index.php?r=goods.list";
  let queriedProductLink = false;
  pwRunner.__setConfigForTest({
    saas: {
      loginUrl: "https://trusted.example/login",
      productListUrl: "https://trusted.example/web/index.php?r=goods.list",
    },
  });
  const keywordInput = {
    async fill() {},
    async press() { currentUrl = "https://attacker.example/web/index.php?r=goods.list"; },
  };
  pwRunner.__setPageForTest({
    async goto() { currentUrl = "https://trusted.example/web/index.php?r=goods.list"; },
    url() { return currentUrl; },
    async waitForTimeout() {},
    async waitForLoadState() {},
    async $(selector) {
      if (selector === "input[name='keyword']") return keywordInput;
      queriedProductLink = true;
      return null;
    },
  });
  const result = await pwRunner.findProductOnList("761");
  assert.equal(result.status, "error");
  assert.equal(queriedProductLink, false);
});

test("findProductOnList searches active sold-out and stock channels and returns channel labels", async () => {
  let currentUrl = "";
  const visited = [];
  pwRunner.__setConfigForTest({
    saas: {
      loginUrl: "https://trusted.example/web/index.php?r=dashboard",
      productListUrl: "https://trusted.example/web/index.php?r=goods",
      productOutListUrl: "https://trusted.example/web/index.php?r=goods.out",
      productStockListUrl: "https://trusted.example/web/index.php?r=goods.stock",
    },
    selectors: { login: { username: "#u", password: "#p", submitButton: "#s", successIndicator: ".ok" } },
  });
  pwRunner.__setPageForTest({
    async goto(url) { currentUrl = url; visited.push(url); },
    url() { return currentUrl; },
    async waitForTimeout() {},
    async waitForLoadState() {},
    async $(selector) {
      if (selector === "input[name='keyword']") return null;
      if (selector === `a[href*="goods.edit&id=761"]` && currentUrl.includes("r=goods.stock")) {
        return { async evaluateHandle(fn) { return fn({ closest() { return { tag: "row" }; } }); } };
      }
      return null;
    },
  });
  const result = await pwRunner.findProductOnList("761");
  assert.equal(result.found, true);
  assert.equal(result.channelKey, "stock");
  assert.equal(result.channelLabel, "仓库");
  assert.ok(visited.some(url => url.includes("r=goods&pagesize=100")));
  assert.ok(visited.some(url => url.includes("r=goods.out&pagesize=100")));
  assert.ok(visited.some(url => url.includes("r=goods.stock&pagesize=100")));
});

test("actionPlatformSearch aggregates products across three channels and preserves channel labels", async () => {
  let currentUrl = "";
  pwRunner.__setConfigForTest({
    saas: {
      loginUrl: "https://trusted.example/web/index.php?r=dashboard",
      productListUrl: "https://trusted.example/web/index.php?r=goods",
      productOutListUrl: "https://trusted.example/web/index.php?r=goods.out",
      productStockListUrl: "https://trusted.example/web/index.php?r=goods.stock",
    },
    selectors: { login: { username: "#u", password: "#p", submitButton: "#s", successIndicator: ".ok" } },
  });
  const keywordInput = { async fill() {}, async press() {} };
  pwRunner.__setPageForTest({
    async goto(url) { currentUrl = url; },
    url() { return currentUrl; },
    async waitForTimeout() {},
    async waitForLoadState() {},
    async $(selector) {
      if (selector === "input[name='keyword']") return keywordInput;
      return null;
    },
    async evaluate() {
      if (currentUrl.includes("r=goods.out")) {
        return [
          { id: "762", name: "售罄商品", text: "售罄商品 | 299", cells: ["售罄商品", "299"], editUrl: "goods.edit&id=762", copyAvailable: true },
          { id: "763", name: "MQ-售罄", text: "MQ-售罄 | 199", cells: ["MQ-售罄", "199"], editUrl: "goods.edit&id=763", copyAvailable: true },
        ];
      }
      if (currentUrl.includes("r=goods.stock")) {
        return [
          { id: "764", name: "仓库商品", text: "仓库商品 | 399", cells: ["仓库商品", "399"], editUrl: "goods.edit&id=764", copyAvailable: false },
        ];
      }
      return [
        { id: "761", name: "在租商品", text: "在租商品 | 199", cells: ["在租商品", "199"], editUrl: "goods.edit&id=761", copyAvailable: true },
      ];
    },
  });
  const result = await pwRunner.handleLegacyAction("platform-search", ["761"]);
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(result.products.map(item => item.channelLabel), ["在租", "售罄", "仓库"]);
  assert.deepEqual(result.products.map(item => item.id), ["761", "762", "764"]);
  assert.deepEqual(result.excluded.map(item => item.channelLabel), ["售罄"]);
  assert.equal(result.channels.length, 3);
});

test("classifySubmitResponseEvidence 把匹配的 3xx 保持为 unknown", () => {
  const url = "https://example.test/web/index.php?r=goods.edit&id=761";
  const result = pwRunner.classifySubmitResponseEvidence({
    url,
    method: "POST",
    httpStatus: 302,
    contentType: "text/html",
    bodyText: "redirect",
  }, { pageUrl: url, expectedProductId: "761" });
  assert.equal(result.status, "unknown");
  assert.equal(result.detail, "http_redirect_302");
});

test("validateSubmitCommand 要求 daemon submit 显式绑定 expectedProductId", () => {
  assert.equal(pwRunner.validateSubmitCommand({ action: "submit" }).status, "error");
  assert.deepEqual(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: 761 }), { status: "ok", expectedProductId: "761" });
  assert.equal(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: "0761" }).status, "error");
  assert.equal(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: 0 }).status, "error");
  assert.equal(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: -1 }).status, "error");
  assert.equal(pwRunner.validateSubmitCommand({ action: "submit", expectedProductId: "abc" }).status, "error");
  assert.equal(pwRunner.validateSubmitCommand({ action: "read" }), null);
});

test("checkExpectedProductUrl 在提交前拒绝当前页商品不匹配", () => {
  const template = "https://example.test/web/index.php?c=site&r=goods.edit&id={productId}";
  const matched = pwRunner.checkExpectedProductUrl("https://example.test/web/index.php?r=goods.edit&id=761", 761, template);
  const mismatched = pwRunner.checkExpectedProductUrl("https://example.test/web/index.php?r=goods.edit&id=762", 761, template);
  assert.equal(matched.ok, true);
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.currentProductId, "762");
  assert.equal(mismatched.expectedProductId, "761");
  assert.equal(pwRunner.checkExpectedProductUrl("https://evil.test/web/index.php?r=goods.edit&id=761", 761, template).ok, false);
  assert.equal(pwRunner.checkExpectedProductUrl("https://example.test/web/other.php?r=goods.edit&id=761", 761, template).ok, false);
  assert.equal(pwRunner.checkExpectedProductUrl("https://example.test/web/index.php?r=goods.list&id=761", 761, template).ok, false);
  assert.equal(pwRunner.checkExpectedProductUrl("https://example.test/web/index.php?r=goods.edit&id=0761", "0761", template).ok, false);
});

test("classifySubmitClickError 不重试派发状态不明的 click timeout", () => {
  assert.deepEqual(pwRunner.classifySubmitClickError(new Error("Timeout 30000ms exceeded while waiting for click")), {
    disposition: "unknown",
    status: "unknown",
    submitted: null,
    sideEffectPossible: true,
    retrySafe: false,
  });
  assert.equal(pwRunner.classifySubmitClickError(new Error("locator.click: Timeout 30000ms exceeded.")).disposition, "unknown");
  assert.equal(pwRunner.classifySubmitClickError(new Error("element intercepts pointer events")).disposition, "retry");
  assert.equal(pwRunner.classifySubmitClickError(new Error("element is not enabled")).disposition, "retry");
  assert.equal(pwRunner.classifySubmitClickError(new Error("Target page closed")).disposition, "error");
});

test("resolveImmediateSubmitOutcome 仅显式网络成功可返回 ok", () => {
  const redirectOnly = pwRunner.resolveImmediateSubmitOutcome({
    responseResult: { status: "unknown", detail: "http_redirect_302" },
    redirectDetail: "redirected_to_login",
  });
  const toastOnly = pwRunner.resolveImmediateSubmitOutcome({
    responseResult: { status: "unknown", detail: "response_timeout" },
    toastDetail: "toast(.message): 保存成功",
  });
  const changedUrl = pwRunner.resolveImmediateSubmitOutcome({
    responseResult: { status: "unknown", detail: "empty_response" },
    redirectDetail: "url_changed: https://example.test/login",
  });
  assert.equal(redirectOnly.status, "unknown");
  assert.equal(redirectOnly.submitted, null);
  assert.equal(toastOnly.status, "unknown");
  assert.equal(toastOnly.submitted, null);
  assert.equal(changedUrl.status, "unknown");
  assert.equal(pwRunner.resolveImmediateSubmitOutcome({ responseResult: { status: "ok", detail: "explicit_json_success" } }).status, "ok");
  assert.equal(pwRunner.resolveImmediateSubmitOutcome({ responseResult: { status: "error", detail: "explicit_json_failure" }, toastDetail: "保存成功" }).status, "error");
});

test("buildSubmitCommand 将 batch submit 绑定到当前 productId", () => {
  assert.deepEqual(batchRunner.buildSubmitCommand(761), { action: "submit", expectedProductId: 761 });
});

test("createSubmitResponseObserver 在响应读取失败时返回 unknown 并幂等清理监听器", async () => {
  const fakePage = new EventEmitter();
  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
    expectedProductId: "761",
    timeoutMs: 100,
  });
  assert.equal(fakePage.listenerCount("response"), 1);
  fakePage.emit("response", {
    url: () => "https://example.test/web/index.php?r=goods.edit&id=761",
    request: () => ({ method: () => "POST" }),
    status: () => 200,
    headers: () => ({ "content-type": "application/json" }),
    text: async () => { throw new Error("body unavailable"); },
  });
  const result = await observer.result;
  assert.equal(result.status, "unknown");
  assert.match(result.detail, /body_read_failed/);
  observer.dispose();
  observer.dispose();
  assert.equal(fakePage.listenerCount("response"), 0);
});

test("createSubmitResponseObserver 锁定首个请求并忽略后续不同请求", async () => {
  const fakePage = new EventEmitter();
  const timers = makeManualTimers();
  const firstRequest = { method: () => "POST" };
  const laterRequest = { method: () => "POST" };
  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
    expectedProductId: "761",
    timeoutMs: 100,
    successGraceMs: 10,
    timers: timers.api,
  });
  try {
    fakePage.emit("response", fakeSubmitResponse('{"success":true}', { request: firstRequest }));
    await new Promise(resolve => setImmediate(resolve));
    fakePage.emit("response", fakeSubmitResponse('{"success":false,"message":"保存失败"}', { request: laterRequest }));
    await new Promise(resolve => setImmediate(resolve));
    timers.run(10);
    assert.equal((await observer.result).status, "ok");
  } finally {
    observer.dispose();
  }
});

test("createSubmitResponseObserver 在短 grace 后完成显式成功而非等待总 deadline", async () => {
  const fakePage = new EventEmitter();
  const timers = makeManualTimers();
  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
    expectedProductId: "761",
    timeoutMs: 100,
    successGraceMs: 10,
    timers: timers.api,
  });
  try {
    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(timers.activeDelays().sort((a, b) => a - b), [10, 100]);
    timers.run(10);
    const result = await observer.result;
    assert.equal(result.status, "ok");
    assert.equal(fakePage.listenerCount("response"), 0);
  } finally {
    observer.dispose();
  }
});

test("createSubmitResponseObserver 忽略 arm 前响应并接受 arm 后响应", async () => {
  const fakePage = new EventEmitter();
  const timers = makeManualTimers();
  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
    expectedProductId: "761",
    timeoutMs: 100,
    successGraceMs: 10,
    timers: timers.api,
    startArmed: false,
  });
  try {
    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(timers.activeDelays(), [100]);
    observer.arm();
    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(timers.activeDelays().includes(10));
    timers.run(10);
    assert.equal((await observer.result).status, "ok");
  } finally {
    observer.dispose();
  }
});

test("createSubmitResponseObserver disarm 后抑制响应直到 rearm", async () => {
  const fakePage = new EventEmitter();
  const timers = makeManualTimers();
  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
    expectedProductId: "761",
    timeoutMs: 100,
    successGraceMs: 10,
    timers: timers.api,
    startArmed: false,
  });
  try {
    observer.arm();
    observer.disarm();
    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(timers.activeDelays(), [100]);
    observer.arm();
    fakePage.emit("response", fakeSubmitResponse('{"status":1}'));
    await new Promise(resolve => setImmediate(resolve));
    timers.run(10);
    assert.equal((await observer.result).status, "ok");
  } finally {
    observer.dispose();
  }
});

test("createSubmitResponseObserver deadline 等待已接收响应的 body 解析", async () => {
  const fakePage = new EventEmitter();
  const timers = makeManualTimers();
  let resolveBody;
  const body = new Promise(resolve => { resolveBody = resolve; });
  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
    expectedProductId: "761",
    timeoutMs: 100,
    successGraceMs: 10,
    bodyReadGraceMs: 20,
    timers: timers.api,
  });
  let settled = false;
  observer.result.then(() => { settled = true; });
  try {
    fakePage.emit("response", fakeSubmitResponse(body));
    await new Promise(resolve => setImmediate(resolve));
    timers.run(100);
    await Promise.resolve();
    assert.equal(settled, false);
    assert.ok(timers.activeDelays().includes(20));
    resolveBody('{"code":"1"}');
    await new Promise(resolve => setImmediate(resolve));
    const result = await observer.result;
    assert.equal(result.status, "ok");
  } finally {
    observer.dispose();
  }
});

test("createSubmitResponseObserver 首个捕获请求 body 未决时保持 unknown", async () => {
  const fakePage = new EventEmitter();
  const timers = makeManualTimers();
  let resolvePendingBody;
  const pendingBody = new Promise(resolve => { resolvePendingBody = resolve; });
  const capturedRequest = { method: () => "POST" };
  const laterRequest = { method: () => "POST" };
  const observer = pwRunner.createSubmitResponseObserver(fakePage, {
    pageUrl: "https://example.test/web/index.php?r=goods.edit&id=761",
    expectedProductId: "761",
    timeoutMs: 100,
    successGraceMs: 10,
    bodyReadGraceMs: 20,
    timers: timers.api,
  });
  try {
    fakePage.emit("response", fakeSubmitResponse(pendingBody, { request: capturedRequest }));
    await new Promise(resolve => setImmediate(resolve));
    fakePage.emit("response", fakeSubmitResponse('{"status":1}', { request: laterRequest }));
    await new Promise(resolve => setImmediate(resolve));
    timers.run(100);
    timers.run(20);
    const result = await observer.result;
    assert.equal(result.status, "unknown");
    assert.equal(result.detail, "body_read_timeout");
  } finally {
    resolvePendingBody('{"status":0}');
    observer.dispose();
  }
});

test("excludeBaselineToastCandidates 排除点击前相同 selector 与文本", () => {
  const baseline = [
    { selector: ".toast", text: "保存成功" },
    { selector: ".message", text: "旧消息" },
  ];
  const current = [
    { selector: ".toast", text: "保存成功" },
    { selector: ".message", text: "保存成功" },
  ];
  assert.deepEqual(pwRunner.excludeBaselineToastCandidates(current, baseline), [
    { selector: ".message", text: "保存成功" },
  ]);
});

test("resolveSubmitByReadback 仅用成功且适用的读回证据解决 unknown", () => {
  const rawUnknown = { status: "unknown", detail: "no decisive signal" };
  const resolved = batchRunner.resolveSubmitByReadback(rawUnknown, [
    { scope: "fields", applicable: true, status: "ok" },
    { scope: "vas", applicable: false, status: "skipped" },
  ]);
  assert.deepEqual(resolved, { status: "ok", resolvedBy: "readback", scopes: ["fields"] });
  assert.equal(batchRunner.resolveSubmitByReadback(rawUnknown, []).status, "verify_failed");
  assert.equal(batchRunner.resolveSubmitByReadback(rawUnknown, [{ scope: "images", applicable: true, status: "failed" }]).status, "verify_failed");
  assert.equal(batchRunner.resolveSubmitByReadback({ status: "error" }, [{ scope: "fields", applicable: true, status: "ok" }]).status, "error");
});

test("normalizeSubmitCommandResult 将 malformed daemon 返回降级为 unknown", () => {
  for (const raw of ["bad response", null, { detail: "missing status" }]) {
    const normalized = batchRunner.normalizeSubmitCommandResult(raw);
    assert.equal(normalized.status, "unknown");
    assert.equal(normalized.submitted, null);
    assert.equal(normalized.sideEffectPossible, true);
    assert.equal(normalized.retrySafe, false);
    assert.equal(normalized.detail, "malformed_submit_response");
    assert.ok(normalized.rawPreview.length <= 500);
  }
  assert.equal(batchRunner.normalizeSubmitCommandResult({ status: "ok", submitted: true }).status, "ok");
});

test("normalizeSubmitCommandResult redacts malformed raw preview secrets", () => {
  const normalized = batchRunner.normalizeSubmitCommandResult({
    code: 1,
    message: "saved",
    token: "raw-secret",
    url: "https://example.test/save?api_key=query-secret&safe=kept",
  });
  assert.match(normalized.rawPreview, /saved/);
  assert.match(normalized.rawPreview, /safe/);
  assert.doesNotMatch(normalized.rawPreview, /raw-secret|query-secret/);
  assert.ok(normalized.rawPreview.length <= 500);
});

test("buildSubmitTransportRecovery 将 transport throw 固化为 submitting recovery", () => {
  const recovered = batchRunner.buildSubmitTransportRecovery({
    productId: 761,
    status: "ok",
    currentValues: { "1": { stock: "5" } },
    expectedChanges: { "1": { stock: "6" } },
    steps: [{ step: "apply", status: "ok" }],
  }, new Error("connection reset"));
  assert.equal(recovered.status, "verify_failed");
  assert.equal(recovered.submitResult.status, "unknown");
  assert.equal(recovered.submitResult.submitted, null);
  assert.equal(recovered.recoveryRequired, true);
  assert.equal(recovered.recoveryPhase, "submitting");
  assert.equal(recovered.automaticResubmitBlocked, true);
  assert.deepEqual(recovered.expectedChanges, { "1": { stock: "6" } });
});

test("evaluateImmediateFieldVerification 对有期望但零 checks 失败关闭", () => {
  const evaluation = batchRunner.evaluateImmediateFieldVerification({}, { stock: "6" });
  assert.equal(evaluation.status, "failed");
  assert.equal(evaluation.verifyResult.total, 1);
  assert.equal(evaluation.verifyResult.mismatched, 1);
});

test("evaluateImmediateScopedVerification 对适用 image/VAS 严格验证 counts", () => {
  const valid = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: 1, mismatched: 0, total: 1 } });
  const zero = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: 0, mismatched: 0, total: 0 } });
  const malformed = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: "1", mismatched: 0, total: 1 } });
  const fractional = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: 0.5, mismatched: 0.5, total: 1 } });
  const wrongTotal = batchRunner.evaluateImmediateScopedVerification({ status: "ok", verifyResult: { matched: 1, mismatched: 0, total: 2 } });
  assert.equal(valid.status, "ok");
  assert.equal(zero.status, "failed");
  assert.equal(malformed.status, "failed");
  assert.equal(fractional.status, "failed");
  assert.equal(wrongTotal.status, "failed");
});

test("buildPostSubmitVerificationRecovery 保留提交证据并阻止自动重提", () => {
  const recovered = batchRunner.buildPostSubmitVerificationRecovery({
    productId: 761,
    status: "ok",
    submitResult: { status: "unknown", detail: "response_timeout", submitted: null },
    currentValues: { "1": { stock: "5" } },
    expectedChanges: { "1": { stock: "6" } },
    steps: [{ step: "submit", status: "unknown" }],
  }, new Error("readback connection reset"));
  assert.equal(recovered.status, "verify_failed");
  assert.equal(recovered.recoveryRequired, true);
  assert.equal(recovered.recoveryPhase, "verification");
  assert.equal(recovered.automaticResubmitBlocked, true);
  assert.equal(recovered.submitResult.status, "unknown");
});

test("buildSubmitAuditSummary 暴露 raw unknown 与 readback resolution", () => {
  const summary = batchRunner.buildSubmitAuditSummary({
    submitResult: { status: "unknown", detail: "response_timeout", submitted: null },
    submitResolution: { status: "ok", resolvedBy: "readback", scopes: ["fields", "vas"] },
  });
  assert.deepEqual(summary, {
    rawStatus: "unknown",
    rawDetail: "response_timeout",
    rawSubmitted: null,
    resolutionStatus: "ok",
    resolvedBy: "readback",
    scopes: ["fields", "vas"],
  });
});

test("buildSubmitAuditSummary 包含有界响应证据但不包含敏感请求数据", () => {
  const summary = batchRunner.buildSubmitAuditSummary({
    submitResult: {
      status: "unknown",
      response: { url: "https://example.test/save", httpStatus: 200, contentType: "application/json", bodyPreview: "x".repeat(700), requestBody: "secret", headers: { cookie: "secret" } },
      rawPreview: "raw".repeat(300),
    },
  });
  assert.equal(summary.responseEvidence.url, "https://example.test/save");
  assert.equal(summary.responseEvidence.httpStatus, 200);
  assert.ok(summary.responseEvidence.bodyPreview.length <= 500);
  assert.ok(summary.responseEvidence.rawPreview.length <= 500);
  assert.equal(summary.responseEvidence.requestBody, undefined);
  assert.equal(summary.responseEvidence.headers, undefined);
  const lines = batchRunner.buildSubmitAuditLines({ submitResult: { status: "unknown", response: { url: "https://example.test/save", httpStatus: 200, contentType: "application/json", bodyPreview: "{}" } } });
  assert.ok(lines.some(line => /Submit response:/.test(line)));
});

test("buildSubmittedCheckpoint 保留 raw submit 与读回恢复所需快照", () => {
  const checkpoint = batchRunner.buildSubmittedCheckpoint({
    productId: 761,
    currentValues: { "1": { stock: "5" } },
    expectedChanges: { "1": { stock: "6" } },
    submitResult: { status: "unknown", detail: "response_timeout", submitted: null },
    steps: [{ step: "submit", status: "unknown" }],
  });
  assert.equal(checkpoint.phase, "submitted");
  assert.equal(checkpoint.productId, 761);
  assert.equal(checkpoint.result.submitResult.status, "unknown");
  assert.deepEqual(checkpoint.result.expectedChanges, { "1": { stock: "6" } });
});

test("buildSubmittingCheckpoint 在发送前保留手工恢复所需状态", () => {
  const checkpoint = batchRunner.buildSubmittingCheckpoint({
    productId: 761,
    currentValues: { "1": { stock: "5" } },
    expectedChanges: { "1": { stock: "6" } },
    imageBefore: { thumbs: { values: ["before.png"] } },
    imageAfter: { thumbs: { values: ["after.png"] } },
    vasBefore: { enabled: false, platforms: [], services: [] },
    vasExpected: { enabled: true, platforms: ["wechat"], services: [] },
    steps: [{ step: "apply", status: "ok" }],
  });
  assert.equal(checkpoint.phase, "submitting");
  assert.equal(checkpoint.productId, 761);
  assert.deepEqual(checkpoint.result.currentValues, { "1": { stock: "5" } });
  assert.deepEqual(checkpoint.result.expectedChanges, { "1": { stock: "6" } });
  assert.equal(checkpoint.result.submitResult, undefined);
});

test("prepareResumeState 阻止 submitted checkpoint 商品自动重提并保留 recovery entry", () => {
  const prepared = batchRunner.prepareResumeState({
    status: "running",
    spec: { items: [{ productId: 761 }, { productId: 762 }, { productId: 763 }] },
    completed: [{ productId: 763, status: "ok" }],
    previewOnly: [],
    verifyFailed: [],
    failed: [],
    inFlight: {
      productId: 761,
      phase: "submitted",
      result: {
        productId: 761,
        status: "ok",
        currentValues: { "1": { stock: "5" } },
        expectedChanges: { "1": { stock: "6" } },
        submitResult: { status: "unknown", detail: "response_timeout", submitted: null },
        steps: [{ step: "submit", status: "unknown" }],
      },
    },
  });
  assert.deepEqual(prepared.remainingItems.map(item => item.productId), [762]);
  assert.equal(prepared.state.inFlight, null);
  assert.equal(prepared.state.verifyFailed.length, 1);
  assert.equal(prepared.state.verifyFailed[0].productId, 761);
  assert.equal(prepared.state.verifyFailed[0].automaticResubmitBlocked, true);
  assert.equal(prepared.state.verifyFailed[0].submitResult.status, "unknown");
  assert.deepEqual(prepared.state.verifyFailed[0].expectedChanges, { "1": { stock: "6" } });
});

test("prepareResumeState 同样阻止 submitting checkpoint 自动重提", () => {
  const prepared = batchRunner.prepareResumeState({
    status: "running",
    spec: { items: [{ productId: 761 }, { productId: 762 }] },
    completed: [], previewOnly: [], verifyFailed: [], failed: [],
    inFlight: {
      productId: 761,
      phase: "submitting",
      result: {
        productId: 761,
        status: "ok",
        currentValues: { "1": { stock: "5" } },
        expectedChanges: { "1": { stock: "6" } },
        steps: [{ step: "apply", status: "ok" }],
      },
    },
  });
  assert.deepEqual(prepared.remainingItems.map(item => item.productId), [762]);
  assert.equal(prepared.state.verifyFailed[0].recoveryPhase, "submitting");
  assert.equal(prepared.state.verifyFailed[0].automaticResubmitBlocked, true);
  assert.equal(prepared.state.status, "recovery_required");
});

test("isResumableBatchState 和 selectLatestResumableBatchState 防止原批次重放", () => {
  assert.equal(batchRunner.isResumableBatchState({ status: "resumed", resumedTo: "child" }), false);
  assert.equal(batchRunner.isResumableBatchState({ status: "stopped" }), true);
  assert.equal(batchRunner.isResumableBatchState({ status: "recovery_required" }), true);
  const selected = batchRunner.selectLatestResumableBatchState([
    { path: "original.json", mtimeMs: 30, state: { status: "resumed", resumedTo: "child" } },
    { path: "child.json", mtimeMs: 20, state: { status: "stopped" } },
  ]);
  assert.equal(selected.path, "child.json");
});

test("writeJsonAtomic 原子替换 JSON 且不遗留临时文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rpa-atomic-"));
  const file = path.join(dir, "state.json");
  try {
    batchRunner.writeJsonAtomic(file, { status: "first" });
    batchRunner.writeJsonAtomic(file, { status: "second", values: [1, 2] });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf-8")), { status: "second", values: [1, 2] });
    assert.deepEqual(fs.readdirSync(dir), ["state.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("getRollbackCandidates 为 confirm 排除 legacy preview_only", () => {
  const candidates = batchRunner.getRollbackCandidates({
    completed: [{ productId: 761, status: "ok" }, { productId: 762, status: "preview_only" }],
    verifyFailed: [{ productId: 763, status: "verify_failed" }],
  });
  assert.deepEqual(candidates.map(entry => entry.productId), [761, 763]);
});

test("buildRollbackExecutionPlan 排除 image-only 无快照候选", () => {
  const plan = batchRunner.buildRollbackExecutionPlan({
    completed: [
      { productId: 761, status: "ok", imageBefore: { thumbs: { values: ["a.png"] } }, imageAfter: { thumbs: { values: ["b.png"] } } },
      { productId: 762, status: "ok", currentValues: { "1": { stock: "5" } }, finalValues: { "1": { stock: "6" } } },
    ],
    verifyFailed: [],
  });
  assert.deepEqual(plan.operations.map(operation => operation.entry.productId), [762]);
  assert.equal(plan.items.length, 1);
});

test("evaluateRollbackVerification 要求非零字段或严格 VAS 证据", () => {
  const noEvidence = batchRunner.evaluateRollbackVerification({ currentValues: {}, expectedFields: {}, vasApplicable: false });
  const zeroVAS = batchRunner.evaluateRollbackVerification({
    currentValues: {}, expectedFields: {}, vasApplicable: true,
    vasResult: { status: "ok", verifyResult: { matched: 0, mismatched: 0, total: 0 } },
  });
  const malformedVAS = batchRunner.evaluateRollbackVerification({
    currentValues: {}, expectedFields: {}, vasApplicable: true,
    vasResult: { status: "ok", verifyResult: {} },
  });
  const fieldsOk = batchRunner.evaluateRollbackVerification({ currentValues: { "1": { stock: "5" } }, expectedFields: { "1": { stock: "5" } }, vasApplicable: false });
  assert.equal(noEvidence.status, "error");
  assert.equal(zeroVAS.status, "error");
  assert.equal(malformedVAS.status, "error");
  assert.equal(fieldsOk.status, "verified");
  assert.ok(fieldsOk.total > 0);
});

test("buildMirrorWritebackPayload 使用 saas_verify 与验证时间", () => {
  const payload = mirrorSearch.buildMirrorWritebackPayload(761, [{ SKU: "A", fields: { 库存: "6" } }], "2026-07-10T10:00:00.000Z");
  assert.deepEqual(payload, {
    goods_id: 761,
    sku_updates: [{ SKU: "A", fields: { 库存: "6" } }],
    source: "saas_verify",
    verified_at: "2026-07-10T10:00:00.000Z",
  });
});

test("resolveVerifiedWritebackTimestamp 要求真实有效 delayedVerify.at", () => {
  assert.equal(mirrorSearch.resolveVerifiedWritebackTimestamp({ status: "delayed_verified" }).ok, false);
  assert.equal(mirrorSearch.resolveVerifiedWritebackTimestamp({ status: "delayed_verified", delayedVerify: { at: "not-a-date" } }).ok, false);
  assert.deepEqual(mirrorSearch.resolveVerifiedWritebackTimestamp({ status: "delayed_verified", delayedVerify: { at: "2026-07-10T10:00:00.000Z" } }), {
    ok: true,
    verificationAt: "2026-07-10T10:00:00.000Z",
  });
});

test("buildMirrorFieldUpdates 完整映射 dynamic rent 且拒绝未知字段", () => {
  assert.deepEqual(mirrorSearch.buildMirrorFieldUpdates({ stock: "6", rent45day: "120.00" }), {
    ok: true,
    skuFields: { 库存: "6", "45天租金": "120.00" },
    unmappedFields: [],
  });
  const rejected = mirrorSearch.buildMirrorFieldUpdates({ stock: "6", mysteryField: "x" });
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.unmappedFields, ["mysteryField"]);
  assert.deepEqual(rejected.skuFields, {});
});

test("evaluateDelayedVerification 对 read 错误和有期望但零 checks 失败关闭", () => {
  const readError = batchRunner.evaluateDelayedVerification({
    readResult: { status: "error", message: "read failed" },
    expectedChanges: { stock: "6" },
    imageApplicable: false,
    vasApplicable: false,
  });
  assert.equal(readError.status, "error");
  assert.ok(readError.failed > 0);

  const zeroChecks = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: {} },
    expectedChanges: { stock: "6" },
    imageApplicable: false,
    vasApplicable: false,
  });
  assert.equal(zeroChecks.status, "error");
  assert.ok(zeroChecks.failed > 0);
});

test("evaluateDelayedVerification 对适用但缺失结果的图片验证失败关闭", () => {
  const imageError = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: { "1": {} } },
    expectedChanges: {},
    imageApplicable: true,
    imageResult: { status: "error", message: "image verify failed" },
    vasApplicable: false,
  });
  const imageMissingResult = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: { "1": {} } },
    expectedChanges: {},
    imageApplicable: true,
    imageResult: { status: "ok" },
    vasApplicable: false,
  });
  assert.equal(imageError.status, "error");
  assert.ok(imageError.failed > 0);
  assert.equal(imageMissingResult.status, "error");
  assert.ok(imageMissingResult.failed > 0);
});

test("evaluateDelayedVerification 拒绝空或非数字 image/VAS verifyResult", () => {
  const malformedImage = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {},
    imageApplicable: true, imageResult: { status: "ok", verifyResult: {} }, vasApplicable: false,
  });
  const malformedVAS = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: false,
    vasApplicable: true, vasResult: { status: "ok", verifyResult: { matched: "1", mismatched: -1, total: "0" } },
  });
  assert.equal(malformedImage.status, "error");
  assert.ok(malformedImage.failed > 0);
  assert.equal(malformedVAS.status, "error");
  assert.ok(malformedVAS.failed > 0);
});

test("evaluateDelayedVerification 拒绝 fractional 和 total 不等于计数和", () => {
  const greaterTotal = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: true,
    imageResult: { status: "ok", verifyResult: { matched: 1, mismatched: 0, total: 2 } }, vasApplicable: false,
  });
  const fractional = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: false, vasApplicable: true,
    vasResult: { status: "ok", verifyResult: { matched: 0.5, mismatched: 0.5, total: 1 } },
  });
  assert.equal(greaterTotal.status, "error");
  assert.equal(fractional.status, "error");
});

test("evaluateDelayedVerification 拒绝适用 image/VAS 的 0/0 counts", () => {
  const zeroImage = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: true,
    imageResult: { status: "ok", verifyResult: { matched: 0, mismatched: 0, total: 0 } }, vasApplicable: false,
  });
  const zeroVAS = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: { "1": {} } }, expectedChanges: {}, imageApplicable: false, vasApplicable: true,
    vasResult: { status: "ok", verifyResult: { matched: 0, mismatched: 0, total: 0 } },
  });
  assert.equal(zeroImage.status, "error");
  assert.equal(zeroVAS.status, "error");
});

test("evaluateDelayedVerification 对 setup-only 零检查失败关闭", () => {
  const evaluation = batchRunner.evaluateDelayedVerification({
    readResult: { status: "ok", values: { "1": {} } },
    expectedChanges: {}, imageApplicable: false, vasApplicable: false, requireAnyCheck: true,
  });
  assert.equal(evaluation.status, "error");
  assert.ok(evaluation.failed > 0);
});

test("deriveDelayedStateStatus 不在仍有 unresolved entries 时标记 delayed_verified", () => {
  const verified = [{ productId: 761, status: "verified" }];
  assert.equal(batchRunner.deriveDelayedStateStatus(verified, 0), "delayed_verified");
  assert.equal(batchRunner.deriveDelayedStateStatus(verified, 1), "delayed_verify_partial");
  assert.equal(batchRunner.deriveDelayedStateStatus([{ productId: 761, status: "error" }], 0), "delayed_verify_partial");
});

test("countDelayedUnresolved 包含 submitting/submitted inFlight 且不重复计数", () => {
  assert.equal(batchRunner.countDelayedUnresolved({ verifyFailed: [{ productId: 761 }], inFlight: { productId: 761, phase: "submitted" } }), 1);
  assert.equal(batchRunner.countDelayedUnresolved({ verifyFailed: [{ productId: 761 }], inFlight: { productId: 762, phase: "submitting" } }), 2);
  assert.equal(batchRunner.countDelayedUnresolved({ verifyFailed: [], inFlight: { productId: 762, phase: "reading" } }), 0);
  assert.equal(batchRunner.countDelayedUnresolved({ verifyFailed: [], failed: [{ productId: 763, recoveryRequired: true }], inFlight: null }), 1);
});

test("deriveBatchFinalStatus 优先 recovery_required", () => {
  assert.equal(batchRunner.deriveBatchFinalStatus({ verifyFailed: [{ productId: 761, recoveryRequired: true }], failed: [] }, false), "recovery_required");
  assert.equal(batchRunner.deriveBatchFinalStatus({ verifyFailed: [], failed: [{ productId: 761, automaticResubmitBlocked: true }] }, true), "recovery_required");
  assert.equal(batchRunner.deriveBatchFinalStatus({ verifyFailed: [{ productId: 761 }], failed: [] }, false), "completed_with_mismatch");
});

test("buildSubmitAuditLines 为 failed 条目呈现 raw 与 resolution", () => {
  const lines = batchRunner.buildSubmitAuditLines({
    submitResult: { status: "unknown", detail: "click timeout", submitted: null },
    submitResolution: { status: "verify_failed", resolvedBy: "readback", scopes: ["fields"] },
  }, "    ");
  assert.ok(lines.some(line => /Submit raw: status=unknown/.test(line)));
  assert.ok(lines.some(line => /detail=click timeout/.test(line)));
  assert.ok(lines.some(line => /Submit resolution: status=verify_failed/.test(line)));
});

test("buildVerificationAuditLines 呈现 field/image/VAS/recovery 状态", () => {
  const lines = batchRunner.buildVerificationAuditLines({
    verifyResult: { matched: 1, mismatched: 1, total: 2, mismatches: [{ specId: "1", field: "stock", expected: "6", actual: "5" }] },
    imageVerifyResult: { status: "mismatch", verifyResult: { matched: 2, mismatched: 1, total: 3 } },
    vasVerifyResult: { status: "ok", verifyResult: { matched: 4, mismatched: 0, total: 4 } },
    recoveryRequired: true,
    recoveryPhase: "submitting",
    recoveryMessage: "manual verification required",
  }, "  ");
  assert.ok(lines.some(line => /Field verify: 1\/2/.test(line)));
  assert.ok(lines.some(line => /Image verify: status=mismatch, 2\/3/.test(line)));
  assert.ok(lines.some(line => /VAS verify: status=ok, 4\/4/.test(line)));
  assert.ok(lines.some(line => /Recovery: phase=submitting/.test(line)));
});

test("buildLegacyApplySubmitDecision 仅允许 apply ok 后 submit", () => {
  assert.deepEqual(pwRunner.buildLegacyApplySubmitDecision({ status: "ok" }, true), { shouldSubmit: true, submitResult: null });
  assert.deepEqual(pwRunner.buildLegacyApplySubmitDecision({ status: "partial" }, true), {
    shouldSubmit: false,
    submitResult: { status: "skipped", reason: "apply_status_not_ok", applyStatus: "partial" },
  });
  assert.equal(pwRunner.buildLegacyApplySubmitDecision({ status: "error" }, true).shouldSubmit, false);
  assert.deepEqual(pwRunner.buildLegacyApplySubmitDecision({ status: "ok" }, false), { shouldSubmit: false, submitResult: null });
});

test("dispatchSubmitClick 按 trial -> arm -> force 顺序执行", async () => {
  const calls = [];
  const element = { async click(options) { calls.push(options.trial ? "trial" : (options.force ? "force" : "plain")); } };
  const observer = { arm() { calls.push("arm"); } };
  await pwRunner.dispatchSubmitClick(element, observer);
  assert.deepEqual(calls, ["trial", "arm", "force"]);

  const failureCalls = [];
  const failingElement = { async click(options) { failureCalls.push(options.trial ? "trial" : "force"); throw new Error("trial blocked"); } };
  const untouchedObserver = { arm() { failureCalls.push("arm"); } };
  await assert.rejects(() => pwRunner.dispatchSubmitClick(failingElement, untouchedObserver), /trial blocked/);
  assert.deepEqual(failureCalls, ["trial"]);
});

test("mergeLegacyApplySubmitOutcome 传播 nested submit 到 top-level status", () => {
  const apply = { status: "ok", appliedCount: 2 };
  const unknown = pwRunner.mergeLegacyApplySubmitOutcome(apply, { status: "unknown", submitted: null, sideEffectPossible: true, retrySafe: false });
  const error = pwRunner.mergeLegacyApplySubmitOutcome(apply, { status: "error", message: "save failed" });
  const ok = pwRunner.mergeLegacyApplySubmitOutcome(apply, { status: "ok", submitted: true });
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.sideEffectPossible, true);
  assert.equal(unknown.retrySafe, false);
  assert.equal(unknown.submit.status, "unknown");
  assert.equal(unknown.appliedCount, 2);
  assert.equal(error.status, "error");
  assert.equal(error.submit.status, "error");
  assert.equal(ok.status, "ok");
});

test("compareLegacyVerification 支持 nested 与 flat，并对缺失/read 错误失败", () => {
  const read = { status: "ok", values: { "1": { stock: "6", rent1day: "10" }, "2": { stock: "6", rent1day: "20" } } };
  const nested = pwRunner.compareLegacyVerification(read, { "1": { stock: "6" }, "2": { rent1day: "20" } });
  const flat = pwRunner.compareLegacyVerification(read, { stock: "6" });
  const missing = pwRunner.compareLegacyVerification(read, { "3": { stock: "6" }, "1": { deposit: "100" } });
  const readError = pwRunner.compareLegacyVerification({ status: "error", message: "read failed" }, { stock: "6" });
  assert.equal(nested.status, "ok");
  assert.equal(nested.matches["1"].stock, true);
  assert.equal(flat.status, "ok");
  assert.equal(flat.matches["2"].stock, true);
  assert.equal(missing.status, "mismatch");
  assert.ok(missing.mismatches.some(item => item.specId === "3"));
  assert.ok(missing.mismatches.some(item => item.field === "deposit"));
  assert.equal(readError.status, "error");
});

test("filterPlatformProducts 过滤 MQ 与链接价商品", () => {
  const rows = [
    { id: "1", name: "MQ-专人维护", cells: ["MQ-专人维护", "100"], text: "MQ-专人维护 | 100" },
    { id: "2", name: "普通商品", cells: ["普通商品", "0.01"], text: "普通商品 | 0.01" },
    { id: "3", name: "正常商品", cells: ["正常商品", "199"], text: "正常商品 | 199" },
  ];
  const result = pwRunner.filterPlatformProducts(rows);
  assert.deepEqual(result.products.map(x => x.id), ["3"]);
  assert.deepEqual(result.excluded.map(x => x.reason), ["mq-maintained", "link-price"]);
});

test("filterSearchDetails 过滤 mirror 中 MQ 与链接价商品", () => {
  const products = [
    { id: 1, name: "MQ-维护", skus: [{ "1天租金": "199" }] },
    { id: 2, name: "普通商品", skus: [{ "1天租金": "0.01" }] },
    { id: 3, name: "正常商品", skus: [{ "1天租金": "299" }] },
  ];
  const result = mirrorSearch.filterSearchDetails(products);
  assert.deepEqual(result.items.map(x => x.id), [3]);
  assert.deepEqual(result.excluded.map(x => x.reason), ["mq-maintained", "link-price"]);
});

test("readProductOnTab 在 explicitFields 下把缺失元素标成 partial", async () => {
  pwRunner.__setConfigForTest({
    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
    selectors: { product: { rent1day: "input.option_rent1day_{specId}", rent10day: "input.option_rent10day_{specId}" } },
  });
  const tab = makeFakeTab({
    specs: [{ specId: "3862", title: "默认规格" }],
    rentFields: { "3862": {} },
    elements: {
      "input.option_rent1day_3862": { value: "22.00", tag: "input" },
    },
  });
  const result = await pwRunner.readProductOnTab(tab, "761", ["rent1day", "rent10day"], true);
  assert.equal(result.status, "partial");
  assert.equal(result.readCount, 1);
  assert.equal(result.missingFields.length, 1);
  assert.equal(result.missingFields[0].field, "rent10day");
});

test("readProductOnTab rejects a redirect to a different product before reading specs", async () => {
  pwRunner.__setConfigForTest({
    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
    selectors: { product: {} },
  });
  const tab = makeFakeTab({
    redirectUrl: "https://example.test/web/index.php?r=goods.edit&id=762",
    specs: [{ specId: "3862", title: "wrong product" }],
  });
  await assert.rejects(
    () => pwRunner.readProductOnTab(tab, "761", [], true),
    /Current page product mismatch/
  );
});

test("readProductOnTab 在 explicitFields 且全部缺失时返回 error", async () => {
  pwRunner.__setConfigForTest({
    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
    selectors: { product: { rent1day: "input.option_rent1day_{specId}" } },
  });
  const tab = makeFakeTab({
    specs: [{ specId: "3862", title: "默认规格" }],
    rentFields: { "3862": {} },
    elements: {},
  });
  const result = await pwRunner.readProductOnTab(tab, "761", ["rent1day"], true);
  assert.equal(result.status, "error");
  assert.equal(result.readCount, 0);
  assert.equal(result.missingFields.length, 1);
});

test("readProductOnTab 在非 explicitFields 下保留 warn 但不降为 partial", async () => {
  pwRunner.__setConfigForTest({
    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
    selectors: { product: { rent1day: "input.option_rent1day_{specId}" } },
  });
  const tab = makeFakeTab({
    specs: [{ specId: "3862", title: "默认规格" }],
    rentFields: { "3862": {} },
    elements: {},
  });
  const result = await pwRunner.readProductOnTab(tab, "761", ["rent1day"], false);
  assert.equal(result.status, "ok");
  assert.equal(result.warnings.length, 1);
  assert.equal(result.missingFields.length, 0);
});

test("项目测试 spec 仅允许 761", () => {
  const tasksDir = path.resolve(__dirname, "../tasks");
  const targets = [
    path.join(tasksDir, "test1_uniform.json"),
    path.join(tasksDir, "test2_diff.json"),
    path.join(tasksDir, "test3_tenancy.json"),
  ];
  for (const file of targets) {
    const json = JSON.parse(fs.readFileSync(file, "utf-8"));
    const ids = (json.items || []).map(item => String(item.productId));
    assert.ok(ids.every(id => id === "761"), path.basename(file) + " should only target product 761");
  }
});

test("活跃示例商品 ID 只使用 761", () => {
  const targets = [
    path.resolve(__dirname, "../SKILL.md"),
    path.resolve(__dirname, "./batch-runner.js"),
    path.resolve(__dirname, "../README.md"),
  ];
  assert.equal(extractActiveExampleText("live product 653 safety limit", ".md").includes("653"), false);
  assert.equal(extractActiveExampleText("prose 653\n```json\n{\"productId\":762}\n```", ".md").includes("762"), true);
  for (const file of targets) {
    const text = fs.readFileSync(file, "utf-8");
    const activeText = extractActiveExampleText(text, path.extname(file).toLowerCase());
    const ids = [...activeText.matchAll(/\b(?:653|76[123])\b/g)].map(match => match[0]);
    assert.ok(ids.every(id => id === "761"), path.basename(file) + " active examples should only use product 761, got: " + ids.join(","));
  }
});

// --- Dynamic rent field tests ---

test("config 包含 _dynamicFields.rentDays 发现规则", () => {
  const configPath = path.resolve(__dirname, "../config.json");
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const df = cfg.selectors && cfg.selectors.product && cfg.selectors.product._dynamicFields;
  assert.ok(df && df.rentDays, "config.selectors.product._dynamicFields.rentDays must exist");
  const r = df.rentDays;
  assert.ok(r.scanSelector, "rentDays.scanSelector must exist");
  assert.ok(r.extractDaysRegex, "rentDays.extractDaysRegex must exist");
  assert.ok(r.selectorTemplate, "rentDays.selectorTemplate must exist");
  assert.ok(r.fieldTemplate, "rentDays.fieldTemplate must exist");
});

test("config 不再包含静态 rent1day/rent10day/rent30day selector", () => {
  const configPath = path.resolve(__dirname, "../config.json");
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const product = cfg.selectors && cfg.selectors.product;
  assert.equal(product.rent1day, undefined, "rent1day should be removed (now dynamic)");
  assert.equal(product.rent10day, undefined, "rent10day should be removed (now dynamic)");
  assert.equal(product.rent30day, undefined, "rent30day should be removed (now dynamic)");
});

test("isDynamicRentField 识别 rent{N}day 格式", () => {
  assert.equal(pwRunner.isDynamicRentField("rent1day"), true);
  assert.equal(pwRunner.isDynamicRentField("rent30day"), true);
  assert.equal(pwRunner.isDynamicRentField("rent180day"), true);
  assert.equal(pwRunner.isDynamicRentField("rent45day"), true);
  assert.equal(pwRunner.isDynamicRentField("stock"), false);
  assert.equal(pwRunner.isDynamicRentField("marketPrice"), false);
  assert.equal(pwRunner.isDynamicRentField("rentday"), false);
});

test("resolveDynamicRentSelector 从模板生成 selector", () => {
  pwRunner.__setConfigForTest({
    selectors: {
      product: {
        _dynamicFields: {
          rentDays: {
            selectorTemplate: "input.option_rent{days}day_{specId}",
            extractDaysRegex: "option_rent(\\d+)day",
            fieldTemplate: "rent{days}day",
            scanSelector: "input[class*='option_rent'][class*='day']",
          }
        }
      }
    }
  });
  assert.equal(
    pwRunner.resolveDynamicRentSelector("rent5day", "3862"),
    "input.option_rent5day_3862"
  );
  assert.equal(
    pwRunner.resolveDynamicRentSelector("rent180day", "9999"),
    "input.option_rent180day_9999"
  );
  assert.equal(
    pwRunner.resolveDynamicRentSelector("stock", "3862"),
    null
  );
});

test("resolveFieldSelector 优先用静态配置，动态 fallback 租期字段", () => {
  pwRunner.__setConfigForTest({
    selectors: {
      product: {
        stock: "input.option_stock_{specId}",
        _dynamicFields: {
          rentDays: {
            selectorTemplate: "input.option_rent{days}day_{specId}",
            extractDaysRegex: "option_rent(\\d+)day",
            fieldTemplate: "rent{days}day",
            scanSelector: "input[class*='option_rent'][class*='day']",
          }
        }
      }
    }
  });
  // Static field
  assert.equal(
    pwRunner.resolveFieldSelector("stock", "3862"),
    "input.option_stock_3862"
  );
  // Dynamic rent field
  assert.equal(
    pwRunner.resolveFieldSelector("rent7day", "3862"),
    "input.option_rent7day_3862"
  );
  assert.equal(
    pwRunner.resolveFieldSelector("rent180day", "3862"),
    "input.option_rent180day_3862"
  );
  // Unknown field
  assert.equal(
    pwRunner.resolveFieldSelector("unknownField", "3862"),
    null
  );
});

test("skuToFieldName 动态 fallback 匹配任意 N天租金", () => {
  // Known mappings still work
  assert.equal(mirrorSearch.skuToFieldName("1天租金"), "rent1day");
  assert.equal(mirrorSearch.skuToFieldName("30天租金"), "rent30day");
  assert.equal(mirrorSearch.skuToFieldName("库存"), "stock");
  // Dynamic fallback for arbitrary periods
  assert.equal(mirrorSearch.skuToFieldName("45天租金"), "rent45day");
  assert.equal(mirrorSearch.skuToFieldName("120天租金"), "rent120day");
  assert.equal(mirrorSearch.skuToFieldName("365天租金"), "rent365day");
  // Non-rent fields still return null
  assert.equal(mirrorSearch.skuToFieldName("未知字段"), null);
});

test("readProductOnTab 非 explicitFields 时自动发现动态租期字段", async () => {
  pwRunner.__setConfigForTest({
    saas: { productDetailUrl: "https://example.test/web/index.php?r=goods.edit&id={productId}" },
    selectors: {
      product: {
        stock: "input.option_stock_{specId}",
        _dynamicFields: {
          rentDays: {
            selectorTemplate: "input.option_rent{days}day_{specId}",
            extractDaysRegex: "option_rent(\\d+)day",
            fieldTemplate: "rent{days}day",
            scanSelector: "input[class*='option_rent'][class*='day']",
          }
        }
      }
    }
  });
  const tab = makeFakeTab({
    specs: [{ specId: "3862", title: "默认规格" }],
    rentFields: { "3862": { rent1day: 1, rent5day: 5, rent30day: 30 } },
    elements: {
      "input.option_stock_3862": { value: "10", tag: "input" },
      "input.option_rent1day_3862": { value: "22.00", tag: "input" },
      "input.option_rent5day_3862": { value: "88.00", tag: "input" },
      "input.option_rent30day_3862": { value: "300.00", tag: "input" },
    },
  });
  // Pass static fields (simulating actionBatchRead which resolves getProductFields()), explicitFields=false
  const result = await pwRunner.readProductOnTab(tab, "761", ["stock"], false);
  assert.equal(result.status, "ok");
  const vals = result.values["3862"];
  assert.equal(vals.stock, "10");
  assert.equal(vals.rent1day, "22.00");
  assert.equal(vals.rent5day, "88.00");
  assert.equal(vals.rent30day, "300.00");
  // Should have discovered 3 rent fields
  assert.equal(Object.keys(result.dynamicRentFields["3862"]).length, 3);
});

(async () => {
  let passed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      process.stdout.write("[PASS] " + item.name + "\n");
      passed++;
    } catch (err) {
      process.stderr.write("[FAIL] " + item.name + "\n");
      process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
      process.exitCode = 1;
    }
  }
  process.stdout.write("\n" + passed + "/" + tests.length + " tests passed\n");
  if (process.exitCode) process.exit(process.exitCode);
})();
