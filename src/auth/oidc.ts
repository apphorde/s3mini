import { createPublicKey, verify } from "node:crypto";

type Jwk = { kid?: string; kty?: string; [key: string]: unknown };
type Jwks = { keys?: Jwk[] };

const jwksCache = new Map<string, { keys: Jwks; expiresAt: number }>();
const introspectionCache = new Map<
  string,
  { active: boolean; scopes: string[]; expiresAt: number }
>();

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export async function verifyOidcToken(
  token: string,
  issuer: string,
  audience: string,
): Promise<void> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");

  let header: { alg?: string; kid?: string };
  let payload: {
    iss?: string;
    aud?: string | string[];
    sub?: string;
    exp?: number;
    nbf?: number;
  };
  let signature: Buffer;
  try {
    header = JSON.parse(decodeBase64Url(parts[0]).toString("utf8"));
    payload = JSON.parse(decodeBase64Url(parts[1]).toString("utf8"));
    signature = decodeBase64Url(parts[2]);
  } catch {
    throw new Error("Invalid JWT");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string")
    throw new Error("Unsupported JWT");

  const cached = jwksCache.get(issuer);
  let jwks: Jwks;
  if (cached && Date.now() < cached.expiresAt) jwks = cached.keys;
  else {
    const response = await fetch(new URL("/.well-known/jwks.json", issuer));
    if (!response.ok)
      throw new Error(`Could not load JWKS: ${response.status}`);
    jwks = (await response.json()) as Jwks;
    jwksCache.set(issuer, {
      keys: jwks,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
  }

  const jwk = jwks.keys?.find(
    (key) => key.kid === header.kid && key.kty === "RSA",
  );
  if (!jwk) throw new Error("Unknown JWT signing key");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  if (
    !verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      signature,
    )
  )
    throw new Error("Invalid JWT signature");

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    payload.iss !== issuer ||
    !audiences.includes(audience) ||
    typeof payload.sub !== "string"
  )
    throw new Error("Invalid JWT claims");
  if (typeof payload.exp !== "number" || payload.exp <= now)
    throw new Error("Expired JWT");
  if (typeof payload.nbf === "number" && payload.nbf > now)
    throw new Error("JWT is not active");
}

export async function introspectOidcToken(
  token: string,
  issuer: string,
  clientId: string,
  clientSecret: string,
): Promise<{ active: boolean; scopes: string[] }> {
  const cached = introspectionCache.get(token);
  if (cached && Date.now() < cached.expiresAt)
    return { active: cached.active, scopes: cached.scopes };
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const response = await fetch(new URL("/oauth/introspect", issuer), {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token, token_type_hint: "access_token" }),
  });
  if (!response.ok)
    throw new Error(`Could not introspect token: ${response.status}`);
  const result = (await response.json()) as {
    active?: boolean;
    scope?: string | string[];
    exp?: number;
  };
  const scopes = Array.isArray(result.scope)
    ? result.scope
    : typeof result.scope === "string"
      ? result.scope.split(/\s+/).filter(Boolean)
      : [];
  const expiresAt = result.exp
    ? Math.min(result.exp * 1000, Date.now() + 30_000)
    : Date.now() + 30_000;
  const value = { active: result.active === true, scopes, expiresAt };
  introspectionCache.set(token, value);
  return { active: value.active, scopes: value.scopes };
}
