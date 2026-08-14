import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrustedRequest, readJsonBody } from "../lib/http.js";

function req(host, { origin, secFetchSite } = {}) {
  return {
    url: "/api/dsh-auto-approval-plugin/config",
    headers: {
      host,
      ...origin === undefined ? {} : { origin },
      ...secFetchSite === undefined ? {} : { "sec-fetch-site": secFetchSite }
    }
  };
}

test("loopback hosts are trusted", () => {
  assert.equal(isTrustedRequest(req("127.0.0.1:3080")), true);
  assert.equal(isTrustedRequest(req("localhost:3080")), true);
  assert.equal(isTrustedRequest(req("[::1]:3080")), true);
});

test("cross-site fetches are rejected even from loopback", () => {
  assert.equal(isTrustedRequest(req("127.0.0.1:3080", { secFetchSite: "cross-site" })), false);
});

test("an Origin must match the Host", () => {
  assert.equal(isTrustedRequest(req("127.0.0.1:3080", { origin: "http://127.0.0.1:3080" })), true);
  assert.equal(isTrustedRequest(req("127.0.0.1:3080", { origin: "http://evil.example" })), false);
});

test("non-loopback hosts require a configured trustedHosts entry", () => {
  assert.equal(isTrustedRequest(req("dsh.example.com")), false);
  assert.equal(isTrustedRequest(req("dsh.example.com"), ["dsh.example.com"]), true);
  assert.equal(isTrustedRequest(req("dsh.example.com:8443"), ["dsh.example.com:8443"]), true);
  // a bare-host entry matches the hostname across ports (same semantics as the DSH upload manager)
  assert.equal(isTrustedRequest(req("dsh.example.com:8443"), ["dsh.example.com"]), true);
  assert.equal(isTrustedRequest(req("other.example.com"), ["dsh.example.com"]), false);
});

test("a missing Host header is rejected", () => {
  assert.equal(isTrustedRequest({ url: "/x", headers: {} }), false);
});

test("readJsonBody parses a JSON object body", async () => {
  const req = (chunks) => ({ [Symbol.asyncIterator]: async function* () { for (const chunk of chunks) yield chunk; } });
  assert.deepEqual(await readJsonBody(req(["{\"a\":1}"])), { a: 1 });
  assert.deepEqual(await readJsonBody(req([])), {});
});

test("readJsonBody rejects invalid JSON and non-object bodies", async () => {
  const req = (chunks) => ({ [Symbol.asyncIterator]: async function* () { for (const chunk of chunks) yield chunk; } });
  await assert.rejects(() => readJsonBody(req(["not json"])), /invalid JSON body/);
  await assert.rejects(() => readJsonBody(req(["[1,2]"])), /expected a JSON object/);
  await assert.rejects(() => readJsonBody(req(["\"str\""])), /expected a JSON object/);
});

test("readJsonBody rejects oversized bodies before buffering them fully", async () => {
  const big = "x".repeat(1024);
  const req = (chunks) => ({ [Symbol.asyncIterator]: async function* () { for (const chunk of chunks) yield chunk; } });
  await assert.rejects(() => readJsonBody(req([big, big, big, big, "{\"a\":1}"]), 2048), /request body too large/);
});
