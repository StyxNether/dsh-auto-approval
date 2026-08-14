/**
 * dsh-auto-approval — configuration HTTP surface.
 *
 * A small same-origin REST API for the web settings card. Every request must
 * pass the same trusted-origin gate the DSH upload manager uses: loopback
 * hosts are accepted, non-loopback hosts must be configured in
 * `trustedHosts`, and a cross-site `sec-fetch-site` is always rejected.
 * The API exposes no secrets and no session data: it reads and writes only
 * this plugin's own settings namespace.
 */

export const CONFIG_PATH = "/api/dsh-auto-approval/config";
export const STATUS_PATH = "/api/dsh-auto-approval/status";

/** Maximum accepted PUT body (the config document is tiny; this bounds memory). */
export const MAX_BODY_BYTES = 256 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Read and parse a bounded JSON request body. A body larger than `limit`
 * rejects with 413 before it is fully buffered.
 * @param req - the Node HTTP request (async iterable).
 * @param limit - maximum accepted bytes.
 * @returns the parsed JSON value.
 */
export async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  let body = "";
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new HttpError(413, "request body too large");
    body += chunk;
  }
  let parsed;
  try {
    parsed = body === "" ? {} : JSON.parse(body);
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, "expected a JSON object");
  }
  return parsed;
}

function requestUrl(req) {
  return new URL(req.url || "/", "http://dsh.internal");
}

function header(headers, key) {
  const value = headers[key];
  return typeof value === "string" ? value : undefined;
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return undefined;
  }
}

function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
  return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}

function assertTrustedAuthority(entry) {
  const entryUrl = parseAuthority(entry);
  if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return;
  throw new Error(`dsh-auto-approval: trusted host ${JSON.stringify(entry)} is not a bare host[:port] authority`);
}

function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry);
    if (entryUrl === undefined) return false;
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host;
  });
}

/**
 * Gate one request by Host/Origin: loopback or configured trusted hosts,
 * same-site fetch, and a matching Origin when one is sent.
 * @param req - the Node HTTP request.
 * @param trustedHosts - configured non-loopback authorities.
 * @returns whether the request may reach the API.
 */
export function isTrustedRequest(req, trustedHosts = []) {
  const host = header(req.headers, "host");
  if (host === undefined) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === undefined) return false;
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
  if (header(req.headers, "sec-fetch-site") === "cross-site") return false;

  const origin = header(req.headers, "origin");
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendError(res, error, onError) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.message });
    return;
  }
  onError?.(error);
  sendJson(res, 500, { error: "internal server error" });
}

function methodNotAllowed(res, methods) {
  res.writeHead(405, { allow: methods.join(", "), "content-length": 0 });
  res.end();
}

/**
 * Build the config/status route handler.
 * @param options
 * @param options.trustedHosts - non-loopback authorities allowed through the gate.
 * @param options.readConfig - () => plain JSON of the effective config.
 * @param options.writeConfig - async (body) => result JSON; body may carry a
 *   `$reset: true` marker to clear the user layer back to composition defaults.
 * @param options.readStatus - () => plain JSON status snapshot.
 * @param options.onError - sink for unexpected handler errors.
 * @returns the handler to register on `ctx.webServer`.
 */
export function createHandlers({ trustedHosts = [], readConfig, writeConfig, readStatus, onError = () => {} }) {
  for (const entry of trustedHosts) assertTrustedAuthority(entry);

  const requireTrusted = (req) => {
    if (!isTrustedRequest(req, trustedHosts)) throw new HttpError(403, "forbidden");
  };

  const api = async (req, res) => {
    try {
      requireTrusted(req);
      const url = requestUrl(req);
      if (url.pathname === CONFIG_PATH) {
        if (req.method === "GET" || req.method === "HEAD") {
          sendJson(res, 200, readConfig());
          return;
        }
        if (req.method === "PUT") {
          const parsed = await readJsonBody(req);
          sendJson(res, 200, await writeConfig(parsed));
          return;
        }
        methodNotAllowed(res, ["GET", "PUT"]);
        return;
      }
      if (url.pathname === STATUS_PATH && (req.method === "GET" || req.method === "HEAD")) {
        sendJson(res, 200, readStatus());
        return;
      }
      methodNotAllowed(res, ["GET", "PUT"]);
    } catch (error) {
      sendError(res, error, onError);
    }
  };

  return { api };
}
