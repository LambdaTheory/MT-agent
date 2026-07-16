const dns = require("dns");
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");
const tls = require("tls");

if (process.env.LIFECYCLE_TEST_GUARD === "1" && !globalThis.__rentalLifecycleGuard) {
  const evidencePath = process.env.LIFECYCLE_TEST_EVIDENCE_PATH || "";
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const originalNetConnect = net.connect;
  const originalNetCreateConnection = net.createConnection;
  const originalSocketConnect = net.Socket.prototype.connect;
  const originalTlsConnect = tls.connect;
  const originalServerListen = net.Server.prototype.listen;
  const originalDnsLookup = dns.lookup;
  const originalDnsResolve4 = dns.resolve4;
  const originalDnsResolve6 = dns.resolve6;
  const originalDnsResolve = dns.resolve;
  const originalDnsPromisesLookup = dns.promises && dns.promises.lookup;
  const originalDnsPromisesResolve4 = dns.promises && dns.promises.resolve4;
  const originalDnsPromisesResolve6 = dns.promises && dns.promises.resolve6;
  const localPorts = new Set();
  const SAAS_PATTERN = /(?:goods\.edit|\/web\/|\/merchant(?:\/|$)|\/admin(?:\/|$)|\b(?:login|submit|upload|delist)\b|vas[-_/]?(?:apply|update)|batch[-_/]?(?:apply|submit))/i;

  function record(type, detail = {}) {
    if (!evidencePath) return;
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.appendFileSync(evidencePath, JSON.stringify({ type, pid: process.pid, ...detail }) + "\n", "utf8");
  }

  function normalizeHost(host) {
    return String(host || "localhost").trim().toLowerCase().replace(/^\[|\]$/g, "");
  }

  function isLoopback(host) {
    const normalized = normalizeHost(host);
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
  }

  function readRegisteredPorts() {
    const ports = new Set(localPorts);
    if (!evidencePath || !fs.existsSync(evidencePath)) return ports;
    const lines = fs.readFileSync(evidencePath, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "loopback-listener" && Number.isInteger(event.port)) ports.add(event.port);
      } catch {}
    }
    return ports;
  }

  function blockedError(api, target) {
    const error = new Error("Lifecycle test guard blocked external network via " + api + ": " + target);
    error.code = "LIFECYCLE_EXTERNAL_NETWORK_BLOCKED";
    return error;
  }

  function inspectTarget(api, host, port, target) {
    const normalizedHost = normalizeHost(host);
    const numericPort = Number(port || 0);
    if (isLoopback(normalizedHost)) {
      const registered = numericPort > 0 && readRegisteredPorts().has(numericPort);
      if (numericPort > 0 && !registered) {
        record("network-intercepted", { api, host: normalizedHost, port: numericPort, target, reason: "unregistered-loopback-port", saas: false });
        throw blockedError(api, target);
      }
      record("loopback-request", { api, host: normalizedHost, port: numericPort, target });
      return;
    }
    const saas = SAAS_PATTERN.test(String(target || ""));
    record("network-intercepted", { api, host: normalizedHost, port: numericPort, target, reason: "non-loopback", saas });
    throw blockedError(api, target);
  }

  function requestTarget(defaultProtocol, input, options) {
    if (input instanceof URL || typeof input === "string") {
      const url = input instanceof URL ? input : new URL(input);
      return { host: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)), target: url.href };
    }
    const value = input && typeof input === "object" ? input : options || {};
    const protocol = value.protocol || defaultProtocol;
    const host = value.hostname || value.host || "localhost";
    const port = Number(value.port || (protocol === "https:" ? 443 : 80));
    return { host, port, target: protocol + "//" + host + ":" + port + String(value.path || "/") };
  }

  function socketTarget(args, defaultPort) {
    const first = args[0];
    if (first && typeof first === "object") {
      return { host: first.host || first.hostname || "localhost", port: Number(first.port || defaultPort), target: String(first.host || first.hostname || "localhost") + ":" + Number(first.port || defaultPort) };
    }
    const port = Number(first || defaultPort);
    const host = typeof args[1] === "string" ? args[1] : "localhost";
    return { host, port, target: host + ":" + port };
  }

  function wrapRequest(api, original, protocol) {
    return function guardedRequest(input, options, callback) {
      const target = requestTarget(protocol, input, options);
      inspectTarget(api, target.host, target.port, target.target);
      return original.apply(this, arguments);
    };
  }

  function wrapGet(api, original, protocol) {
    return function guardedGet(input, options, callback) {
      const target = requestTarget(protocol, input, options);
      inspectTarget(api, target.host, target.port, target.target);
      return original.apply(this, arguments);
    };
  }

  if (typeof originalFetch === "function") {
    globalThis.fetch = function guardedFetch(input, init) {
      try {
        const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
        inspectTarget("fetch", url.hostname, Number(url.port || (url.protocol === "https:" ? 443 : 80)), url.href);
      } catch (error) {
        return Promise.reject(error);
      }
      return originalFetch.call(this, input, init);
    };
  }
  http.request = wrapRequest("http.request", originalHttpRequest, "http:");
  http.get = wrapGet("http.get", originalHttpGet, "http:");
  https.request = wrapRequest("https.request", originalHttpsRequest, "https:");
  https.get = wrapGet("https.get", originalHttpsGet, "https:");
  net.connect = function guardedNetConnect() {
    const target = socketTarget(arguments, 0);
    inspectTarget("net.connect", target.host, target.port, target.target);
    return originalNetConnect.apply(this, arguments);
  };
  net.createConnection = function guardedNetCreateConnection() {
    const target = socketTarget(arguments, 0);
    inspectTarget("net.createConnection", target.host, target.port, target.target);
    return originalNetCreateConnection.apply(this, arguments);
  };
  net.Socket.prototype.connect = function guardedSocketConnect() {
    const target = socketTarget(arguments, 0);
    inspectTarget("net.Socket.connect", target.host, target.port, target.target);
    return originalSocketConnect.apply(this, arguments);
  };
  tls.connect = function guardedTlsConnect() {
    const target = socketTarget(arguments, 443);
    inspectTarget("tls.connect", target.host, target.port, target.target);
    return originalTlsConnect.apply(this, arguments);
  };

  function wrapDns(api, original) {
    return function guardedDns(hostname) {
      if (!isLoopback(hostname)) {
        record("network-intercepted", { api, host: normalizeHost(hostname), port: 0, target: String(hostname), reason: "dns-non-loopback", saas: SAAS_PATTERN.test(String(hostname)) });
        throw blockedError(api, String(hostname));
      }
      return original.apply(this, arguments);
    };
  }
  dns.lookup = wrapDns("dns.lookup", originalDnsLookup);
  dns.resolve = wrapDns("dns.resolve", originalDnsResolve);
  dns.resolve4 = wrapDns("dns.resolve4", originalDnsResolve4);
  dns.resolve6 = wrapDns("dns.resolve6", originalDnsResolve6);
  if (dns.promises) {
    if (originalDnsPromisesLookup) dns.promises.lookup = wrapDns("dns.promises.lookup", originalDnsPromisesLookup);
    if (originalDnsPromisesResolve4) dns.promises.resolve4 = wrapDns("dns.promises.resolve4", originalDnsPromisesResolve4);
    if (originalDnsPromisesResolve6) dns.promises.resolve6 = wrapDns("dns.promises.resolve6", originalDnsPromisesResolve6);
  }

  net.Server.prototype.listen = function guardedListen() {
    const server = this;
    const args = Array.from(arguments);
    const callbackIndex = args.findIndex(value => typeof value === "function");
    const originalCallback = callbackIndex >= 0 ? args[callbackIndex] : null;
    const register = () => {
      const address = server.address();
      if (address && typeof address === "object" && isLoopback(address.address)) {
        localPorts.add(address.port);
        record("loopback-listener", { host: normalizeHost(address.address), port: address.port });
      }
      if (originalCallback) originalCallback.call(server);
    };
    if (callbackIndex >= 0) args[callbackIndex] = register;
    else args.push(register);
    return originalServerListen.apply(server, args);
  };

  globalThis.__rentalLifecycleGuard = Object.freeze({
    active: true,
    evidencePath,
    registerLoopbackPort(port) {
      const numericPort = Number(port);
      if (!Number.isInteger(numericPort) || numericPort <= 0) throw new Error("Invalid loopback port");
      localPorts.add(numericPort);
      record("loopback-listener", { host: "127.0.0.1", port: numericPort });
    },
  });
}
