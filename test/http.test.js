import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrustedRequest } from "../lib/http.js";

function req(host, { origin, secFetchSite } = {}) {
  return {
    url: "/api/dsh-auto-approval/config",
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
