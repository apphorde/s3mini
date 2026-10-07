import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const authBase = "https://auth.lab.apphor.de";
const authLabKey = process.env.AUTH_LAB_KEY;
if (!authLabKey) {
  throw new Error("AUTH_LAB_KEY is required.");
}

const runId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const clientId = `s3mini-smoke-${runId}`;
const image = `s3mini-auth-lab:${runId}`;
const container = `s3mini-auth-lab-${runId}`;
const issuerContainer = `${container}-issuer`;
const port =
  19000 + (Number.parseInt(crypto.randomBytes(2).toString("hex"), 16) % 1000);
const dataDir = `/tmp/opencode/s3mini-auth-lab-${runId}`;
const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
const scopes = [
  "openid",
  "profile",
  "email",
  "s3:read",
  "s3:write",
  "s3:admin",
  "s3:provision",
];
const tokens = new Map();
let cookie;
let createdClient = false;
let builtImage = false;
let startedContainer = false;
let startedIssuerContainer = false;
let clientSecret;
let authApiToken;
let authApiTokenId;
let failures = 0;

async function authRequest(path, options = {}) {
  return fetch(`${authBase}${path}`, {
    ...options,
    headers: { cookie, ...(options.headers || {}) },
  });
}

async function responseJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }
  return response.json();
}

function runDocker(args, env = process.env) {
  execFileSync("docker", args, { stdio: "inherit", env });
}

async function createApiToken(label, tokenScopes) {
  const response = await authRequest(
    `/api-tokens/${encodeURIComponent(clientId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, scopes: tokenScopes }),
    },
  );
  const result = await responseJson(response, `issue ${label} token`);
  const value =
    result.token ||
    result.access_token ||
    result.api_token ||
    result.apiToken ||
    result.value;
  if (typeof value !== "string" || !value) {
    throw new Error(
      `Auth Lab's ${label} token response did not contain a token value.`,
    );
  }
  tokens.set(label, { id: result.id || result.tokenId, value });
  return value;
}

async function issueClientAndTokens() {
  const login = await fetch(`${authBase}/__test__/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: authLabKey }),
  });
  if (!login.ok) {
    throw new Error(
      `Auth Lab automation login failed with HTTP ${login.status}.`,
    );
  }
  const cookies = login.headers.getSetCookie?.() || [
    login.headers.get("set-cookie") || "",
  ];
  cookie = cookies
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) {
    throw new Error(
      "Auth Lab automation login did not return a session cookie.",
    );
  }

  const created = await authRequest("/oidc/clients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: clientId, redirectUris: [redirectUri] }),
  });
  if (created.ok) {
    createdClient = true;
  }
  const client = await responseJson(created, "create temporary OIDC client");
  clientSecret = client.secret;
  if (typeof clientSecret !== "string" || !clientSecret) {
    throw new Error(
      "Auth Lab did not return the temporary client's one-time secret.",
    );
  }

  const configured = await authRequest(
    `/oidc/clients/${encodeURIComponent(clientId)}/scopes`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopes }),
    },
  );
  await responseJson(
    configured,
    "allow all S3MINI scopes on the temporary client",
  );
  for (const scope of ["s3:read", "s3:write", "s3:admin"]) {
    await createApiToken(`scope-${scope}`, [scope]);
  }

  const createdApiToken = await authRequest(
    `/auth-api-tokens/${encodeURIComponent(clientId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "S3MINI Auth Lab smoke" }),
    },
  );
  const apiToken = await responseJson(
    createdApiToken,
    "create temporary client-bound Auth API token",
  );
  authApiToken =
    apiToken.token ||
    apiToken.access_token ||
    apiToken.api_token ||
    apiToken.apiToken ||
    apiToken.value;
  authApiTokenId = apiToken.id || apiToken.tokenId;
  if (typeof authApiToken !== "string" || !authApiToken) {
    throw new Error("Auth Lab did not return the temporary Auth API token.");
  }
}

async function startLocalContainer() {
  const childEnv = { ...process.env };
  delete childEnv.AUTH_LAB_KEY;
  runDocker(["build", "-t", image, "."], childEnv);
  builtImage = true;
  const fs = await import("node:fs/promises");
  await fs.mkdir(`${dataDir}/objects`, { recursive: true });
  await fs.chmod(dataDir, 0o777).catch(() => {});
  await fs.chmod(`${dataDir}/objects`, 0o777);
  startedContainer = true;
  const proxyEnvNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
  const args = [
    "run",
    "-d",
    "--name",
    container,
    "-p",
    `127.0.0.1:${port}:9000`,
    "-v",
    `${dataDir}:/data`,
    "-e",
    "AUTH_PROVIDER",
    "-e",
    "OIDC_CLIENT_ID",
    "-e",
    "OIDC_CLIENT_SECRET",
    "-e",
    "OIDC_REDIRECT_URI",
    "-e",
    "S3MINI_DEFAULT_ACCOUNT_QUOTA_BYTES",
  ];
  for (const name of proxyEnvNames) {
    if (childEnv[name]) {
      args.push("-e", name);
    }
  }
  args.push(image);
  runDocker(args, {
    ...childEnv,
    AUTH_PROVIDER: authBase,
    OIDC_CLIENT_ID: clientId,
    OIDC_CLIENT_SECRET: clientSecret,
    OIDC_REDIRECT_URI: redirectUri,
    S3MINI_DEFAULT_ACCOUNT_QUOTA_BYTES: "4",
  });
  const base = "http://127.0.0.1:9000";
  let ready = false;
  let lastStatus = "connection-refused";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const output = execFileSync(
        "docker",
        [
          "exec",
          container,
          "node",
          "-e",
          "fetch('http://127.0.0.1:9000/api').then(r => process.stdout.write(String(r.status))).catch(() => process.exit(1))",
        ],
        {
          env: childEnv,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      lastStatus = output;
      if (output === "200") {
        ready = true;
        break;
      }
    } catch {
      // The application may still be starting.
    }
    await delay(500);
  }
  if (!ready) {
    runDocker(["logs", container], childEnv);
    throw new Error(
      `Local Docker container did not become ready (HTTP ${lastStatus}).`,
    );
  }
  return base;
}

async function startIssuerContainer() {
  const childEnv = { ...process.env };
  delete childEnv.AUTH_LAB_KEY;
  const fs = await import("node:fs/promises");
  const issuerDataDir = `${dataDir}/issuer`;
  await fs.mkdir(`${issuerDataDir}/objects`, { recursive: true });
  await fs.chmod(issuerDataDir, 0o777).catch(() => {});
  await fs.chmod(`${issuerDataDir}/objects`, 0o777);
  startedIssuerContainer = true;
  const args = [
    "run",
    "-d",
    "--name",
    issuerContainer,
    "-v",
    `${issuerDataDir}:/data`,
    "-e",
    "AUTH_PROVIDER",
    "-e",
    "OIDC_CLIENT_ID",
    "-e",
    "OIDC_API_TOKEN",
    "-e",
    "S3MINI_ADMIN_TOKEN",
    image,
  ];
  runDocker(args, {
    ...childEnv,
    AUTH_PROVIDER: authBase,
    OIDC_CLIENT_ID: clientId,
    OIDC_API_TOKEN: authApiToken,
    S3MINI_ADMIN_TOKEN: "auth-lab-local-admin",
  });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const status = execFileSync(
        "docker",
        [
          "exec",
          issuerContainer,
          "node",
          "-e",
          "fetch('http://127.0.0.1:9000/api').then(r => process.stdout.write(String(r.status))).catch(() => process.exit(1))",
        ],
        {
          env: childEnv,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      if (status === "200") {
        ready = true;
        break;
      }
    } catch {
      // The application may still be starting.
    }
    await delay(500);
  }
  if (!ready) {
    runDocker(["logs", issuerContainer], childEnv);
    throw new Error(
      "S3MINI OIDC token-issuer test container did not become ready.",
    );
  }
}

const issuerSmokeCode = String.raw`let input = "";
for await (const chunk of process.stdin) input += chunk;
const data = JSON.parse(input);
const response = await fetch("http://127.0.0.1:9000/admin/oidc/api-tokens", {
  method: "POST",
  headers: {
    authorization: "Bearer " + data.adminToken,
    "content-type": "application/json",
  },
  body: JSON.stringify({ label: "Auth Lab S3MINI integration", scopes: ["s3:provision"] }),
});
if (!response.ok) throw new Error("S3MINI token issuance returned HTTP " + response.status);
const result = await response.json();
if (typeof result.token !== "string" || !result.token) throw new Error("S3MINI returned no issued token");
process.stdout.write(JSON.stringify(result));
`;

async function issueProvisionTokenThroughS3mini() {
  const childEnv = { ...process.env };
  delete childEnv.AUTH_LAB_KEY;
  const output = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      issuerContainer,
      "node",
      "--input-type=module",
      "-e",
      issuerSmokeCode,
    ],
    {
      env: childEnv,
      input: JSON.stringify({ adminToken: "auth-lab-local-admin" }),
      encoding: "utf8",
    },
  );
  const issued = JSON.parse(output);
  tokens.set("scope-s3:provision", { value: issued.token });
  console.log(
    "PASS S3MINI used OIDC_API_TOKEN to issue a client-bound scoped token",
  );
}

const localSmokeCode = String.raw`import crypto from "node:crypto";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const data = JSON.parse(input);
const base = "http://127.0.0.1:9000";
function assert(condition, label) {
  if (!condition) throw new Error("Smoke assertion failed: " + label);
  console.log("PASS " + label);
}
async function api(scope, path, options = {}) {
  return fetch(base + path, {
    ...options,
    headers: {
      authorization: "Bearer " + data.tokens[scope],
      ...(options.headers || {}),
    },
  });
}
async function json(response, label) {
  if (!response.ok) throw new Error(label + " failed with HTTP " + response.status);
  return response.json();
}
const dashboard = await fetch(base + "/admin", { redirect: "manual" });
assert(dashboard.status === 302 && dashboard.headers.get("location") === "/admin/login", "OIDC dashboard requires a browser admin session");
for (const scope of ["s3:read", "s3:write", "s3:admin"]) {
  const response = await api(scope, "/provisioning/accounts");
  assert(response.status === 403, scope + " cannot call provisioning endpoints");
}
for (const scope of ["s3:read", "s3:write", "s3:admin", "s3:provision"]) {
  const response = await api(scope, "/admin/users");
  assert(response.status === 403, scope + " cannot replace the OIDC admin role");
}
const writeToken = data.tokens["s3:write"];
const legacyBucket = "legacy-" + data.runId.replaceAll("-", "");
let response = await fetch(base + "/" + legacyBucket, { method: "PUT", headers: { authorization: "Bearer " + writeToken } });
assert(response.status === 200, "s3:write creates a legacy bucket before tenant provisioning");
response = await fetch(base + "/" + legacyBucket + "/hello.txt", { method: "PUT", headers: { authorization: "Bearer " + writeToken }, body: "read-write-scope" });
assert(response.status === 200, "s3:write stores an object");
response = await fetch(base + "/" + legacyBucket + "/hello.txt", { headers: { authorization: "Bearer " + data.tokens["s3:read"] } });
assert(response.status === 200 && await response.text() === "read-write-scope", "s3:read retrieves an object");
const provisionToken = data.tokens["s3:provision"];
response = await fetch(base + "/provisioning/accounts", { method: "POST", headers: { authorization: "Bearer " + provisionToken, "content-type": "application/json" }, body: JSON.stringify({ externalId: "auth-lab-" + data.runId, displayName: "Auth Lab integration test" }) });
const account = await json(response, "provision test account");
assert(response.status === 201 && account.quotaBytes === 4, "s3:provision creates an account with the configured aggregate quota");
const otherAccountResponse = await fetch(base + "/provisioning/accounts", { method: "POST", headers: { authorization: "Bearer " + provisionToken, "content-type": "application/json" }, body: JSON.stringify({ externalId: "other-" + data.runId }) });
const otherAccount = await json(otherAccountResponse, "provision second test account");
const ownBucket = "tenant-" + data.runId.replaceAll("-", "");
const otherBucket = "other-" + data.runId.replaceAll("-", "");
for (const [ownerId, name] of [[account.accountId, ownBucket], [otherAccount.accountId, otherBucket]]) {
  response = await fetch(base + "/provisioning/accounts/" + ownerId + "/buckets", { method: "POST", headers: { authorization: "Bearer " + provisionToken, "content-type": "application/json" }, body: JSON.stringify({ name }) });
  assert(response.status === 201, "provisioning creates an account-owned bucket");
}
response = await fetch(base + "/provisioning/accounts/" + account.accountId + "/buckets/" + ownBucket + "/policy", { method: "PUT", headers: { authorization: "Bearer " + provisionToken, "content-type": "application/json" }, body: JSON.stringify({ statements: [] }) });
assert(response.status === 204, "s3:provision sets policy on its account bucket");
response = await fetch(base + "/provisioning/accounts/" + account.accountId + "/buckets/" + ownBucket + "/quota", { method: "PUT", headers: { authorization: "Bearer " + provisionToken, "content-type": "application/json" }, body: JSON.stringify({ quotaBytes: 4 }) });
assert(response.status === 204, "s3:provision allocates a per-bucket quota");
response = await fetch(base + "/admin/accounts/" + account.accountId + "/quota", { method: "PUT", headers: { authorization: "Bearer " + provisionToken, "content-type": "application/json" }, body: JSON.stringify({ quotaBytes: 8 }) });
assert(response.status === 403, "s3:provision cannot change the admin-controlled aggregate quota");
response = await fetch(base + "/provisioning/accounts/" + account.accountId + "/buckets/" + otherBucket + "/quota", { method: "PUT", headers: { authorization: "Bearer " + provisionToken, "content-type": "application/json" }, body: JSON.stringify({ quotaBytes: 4 }) });
assert(response.status === 403, "provisioner cannot change another account's bucket quota");
response = await api("s3:provision", "/" + legacyBucket + "/hello.txt");
assert(response.status === 403, "s3:provision cannot access object data");
const keyResponse = await fetch(base + "/provisioning/accounts/" + account.accountId + "/access-keys", { method: "POST", headers: { authorization: "Bearer " + provisionToken, "content-type": "application/json" }, body: JSON.stringify({ displayName: "auth-lab-smoke" }) });
const credentials = await json(keyResponse, "issue account-scoped S3 key");
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function hmac(key, value, encoding) { return crypto.createHmac("sha256", key).update(value).digest(encoding); }
async function signedRequest(method, path, body, creds) {
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(body);
  const payloadHash = digest(payload);
  const signedHeaders = "x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = "x-amz-content-sha256:" + payloadHash + "\n" + "x-amz-date:" + timestamp + "\n";
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = date + "/local/s3/aws4_request";
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, credentialScope, digest(canonicalRequest)].join("\n");
  const kDate = hmac("AWS4" + creds.secretAccessKey, date);
  const kRegion = hmac(kDate, "local");
  const kService = hmac(kRegion, "s3");
  const signingKey = hmac(kService, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  const authorization = "AWS4-HMAC-SHA256 Credential=" + creds.accessKeyId + "/" + credentialScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
  return fetch(base + path, { method, headers: { authorization, "x-amz-date": timestamp, "x-amz-content-sha256": payloadHash, "content-type": "application/octet-stream" }, body: method === "GET" ? undefined : payload });
}
const ownCredentials = { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey };
response = await signedRequest("GET", "/", undefined, ownCredentials);
const listing = await response.text();
assert(response.status === 200 && listing.includes("<Name>" + ownBucket + "</Name>"), "account S3 key lists its own bucket");
assert(!listing.includes("<Name>" + otherBucket + "</Name>"), "account S3 key cannot enumerate another account's bucket");
response = await signedRequest("PUT", "/" + ownBucket + "/four-bytes", "1234", ownCredentials);
assert(response.status === 200, "account S3 key can write within quota");
response = await signedRequest("PUT", "/" + ownBucket + "/over-quota", "x", ownCredentials);
assert(response.status === 403 && (await response.text()).includes("QuotaExceeded"), "S3MINI enforces bucket and aggregate quotas");
response = await signedRequest("GET", "/" + otherBucket + "/four-bytes", undefined, ownCredentials);
assert(response.status === 403, "account S3 key cannot access another account's bucket");
`;

async function exerciseApis() {
  const input = {
    runId,
    tokens: Object.fromEntries(
      [...tokens].map(([label, token]) => [
        label.replace(/^scope-/, ""),
        token.value,
      ]),
    ),
  };
  const childEnv = { ...process.env };
  delete childEnv.AUTH_LAB_KEY;
  const output = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "node",
      "--input-type=module",
      "-e",
      localSmokeCode,
    ],
    { env: childEnv, input: JSON.stringify(input), encoding: "utf8" },
  );
  process.stdout.write(output);
}

async function cleanup() {
  if (cookie && createdClient) {
    for (const token of tokens.values()) {
      if (!token.id) {
        continue;
      }
      try {
        await authRequest(
          `/api-tokens/${encodeURIComponent(clientId)}/${encodeURIComponent(token.id)}`,
          { method: "DELETE" },
        );
      } catch {
        failures += 1;
      }
    }
    if (authApiTokenId) {
      try {
        const response = await authRequest(
          `/auth-api-tokens/${encodeURIComponent(clientId)}/${encodeURIComponent(authApiTokenId)}`,
          { method: "DELETE" },
        );
        if (!response.ok && response.status !== 404) {
          failures += 1;
        }
      } catch {
        failures += 1;
      }
    }
    try {
      const response = await authRequest(
        `/oidc/clients/${encodeURIComponent(clientId)}`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 404) {
        failures += 1;
      } else {
        console.log("PASS temporary Auth Lab client removed");
      }
    } catch {
      failures += 1;
    }
  }
  const childEnv = { ...process.env };
  delete childEnv.AUTH_LAB_KEY;
  if (startedIssuerContainer) {
    try {
      runDocker(["rm", "-f", issuerContainer], childEnv);
    } catch {
      failures += 1;
    }
  }
  if (startedContainer) {
    try {
      runDocker(["rm", "-f", container], childEnv);
    } catch {
      failures += 1;
    }
  }
  if (builtImage) {
    try {
      runDocker(["image", "rm", image], childEnv);
    } catch {
      failures += 1;
    }
  }
  const fs = await import("node:fs/promises");
  await fs.rm(dataDir, { recursive: true, force: true });
}

try {
  await issueClientAndTokens();
  await startLocalContainer();
  await startIssuerContainer();
  await issueProvisionTokenThroughS3mini();
  await exerciseApis();
} catch (error) {
  failures += 1;
  console.error(
    error instanceof Error ? error.message : "Auth Lab smoke test failed.",
  );
} finally {
  await cleanup();
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("Auth Lab and local Docker API smoke tests passed.");
}
