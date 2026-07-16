const { readCurrentMetadata } = require("./version-contract");
const compatibility = require("./daemon-compatibility");
const client = require("./daemon-client");

function createNonceStore(options = {}) {
  const ttlMs = options.ttlMs || 30000;
  const maxEntries = options.maxEntries || 256;
  const now = options.now || Date.now;
  const issued = new Map();
  function prune() {
    const cutoff = now() - ttlMs;
    for (const [nonce, issuedAt] of issued) if (issuedAt < cutoff) issued.delete(nonce);
    while (issued.size >= maxEntries) issued.delete(issued.keys().next().value);
  }
  return {
    issue(nonce) {
      if (typeof nonce !== "string" || !nonce.trim()) return false;
      prune();
      issued.set(nonce, now());
      return true;
    },
    consume(nonce) {
      prune();
      if (!issued.has(nonce)) return false;
      issued.delete(nonce);
      return true;
    },
  };
}

module.exports = {
  ...compatibility,
  ...client,
  createNonceStore,
  readClientManifest: readCurrentMetadata,
};
