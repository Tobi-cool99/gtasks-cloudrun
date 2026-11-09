import { createHash } from "node:crypto";
import { Config } from "./config.js";
import {
  decryptSecret,
  encryptSecret,
  nowSeconds,
  randomId,
  signToken,
  verifyToken,
} from "./tokens.js";

/*
 * Dieser Server ist sein eigener OAuth-Server für Claude. Die eigentliche
 * Anmeldung läuft über Google; nur die in ALLOWED_EMAIL hinterlegte Adresse
 * bekommt Zugang.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/tasks";

const ACCESS_TTL = 60 * 60; // 1 Stunde
const REFRESH_TTL = 60 * 60 * 24 * 90; // 90 Tage
const CODE_TTL = 5 * 60;
const STATE_TTL = 10 * 60;

export interface OAuthError {
  status: number;
  error: string;
  error_description: string;
}

const oauthError = (status: number, error: string, error_description: string): OAuthError => ({
  status,
  error,
  error_description,
});

export function isOAuthError(value: unknown): value is OAuthError {
  return typeof value === "object" && value !== null && "error" in value && "status" in value;
}

export function protectedResourceMetadata(cfg: Config) {
  return {
    resource: cfg.baseUrl,
    authorization_servers: [cfg.baseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["tasks"],
  };
}

export function authorizationServerMetadata(cfg: Config) {
  return {
    issuer: cfg.baseUrl,
    authorization_endpoint: `${cfg.baseUrl}/authorize`,
    token_endpoint: `${cfg.baseUrl}/token`,
    registration_endpoint: `${cfg.baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["tasks"],
  };
}

/** Erlaubt nur die Callback-Adressen von Claude und lokale Clients. */
export function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:" && (u.hostname === "claude.ai" || u.hostname === "claude.com")) {
      return u.pathname === "/api/mcp/auth_callback";
    }
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return true;
    }
  } catch {
    // ungültige URL
  }
  return false;
}

/** Dynamische Client-Registrierung (RFC 7591). Clients brauchen kein Geheimnis. */
export function registerClient(body: unknown): object | OAuthError {
  const redirectUris = (body as { redirect_uris?: unknown })?.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return oauthError(400, "invalid_client_metadata", "redirect_uris fehlt");
  }
  if (!redirectUris.every((uri) => typeof uri === "string" && isAllowedRedirect(uri))) {
    return oauthError(400, "invalid_redirect_uri", "Redirect-URI nicht erlaubt");
  }
  return {
    client_id: `gtasks-${randomId(12)}`,
    client_id_issued_at: nowSeconds(),
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    client_name: (body as { client_name?: string }).client_name ?? "MCP-Client",
  };
}

/** Schritt 1: Claude leitet den Nutzer hierher. Wir schicken ihn zu Google. */
export function startAuthorization(cfg: Config, params: URLSearchParams): { redirect: string } | OAuthError {
  if (params.get("response_type") !== "code") {
    return oauthError(400, "unsupported_response_type", "Nur response_type=code wird unterstützt");
  }
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!isAllowedRedirect(redirectUri)) {
    return oauthError(400, "invalid_request", "redirect_uri nicht erlaubt");
  }
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || params.get("code_challenge_method") !== "S256") {
    return oauthError(400, "invalid_request", "PKCE mit S256 ist erforderlich");
  }

  // Zustand für den Rückweg von Google, signiert statt gespeichert.
  const state = signToken(cfg.tokenSecret, {
    typ: "auth",
    ru: redirectUri,
    cc: codeChallenge,
    st: params.get("state") ?? "",
    exp: nowSeconds() + STATE_TTL,
  });

  const google = new URL(GOOGLE_AUTH_URL);
  google.searchParams.set("client_id", cfg.googleClientId);
  google.searchParams.set("redirect_uri", `${cfg.baseUrl}/oauth/callback`);
  google.searchParams.set("response_type", "code");
  google.searchParams.set("scope", GOOGLE_SCOPES);
  google.searchParams.set("access_type", "offline");
  google.searchParams.set("prompt", "consent");
  google.searchParams.set("login_hint", cfg.allowedEmail);
  google.searchParams.set("state", state);
  return { redirect: google.toString() };
}

/** Schritt 2: Google schickt den Nutzer mit einem Code zurück. */
export async function finishGoogleLogin(
  cfg: Config,
  params: URLSearchParams,
): Promise<{ redirect: string } | OAuthError> {
  if (params.get("error")) {
    return oauthError(400, "access_denied", `Google-Anmeldung abgebrochen: ${params.get("error")}`);
  }
  const state = verifyToken<{ typ: string; ru: string; cc: string; st: string; exp: number }>(
    cfg.tokenSecret,
    params.get("state") ?? "",
  );
  if (!state || state.typ !== "auth") {
    return oauthError(400, "invalid_request", "Ungültiger oder abgelaufener Status");
  }
  const code = params.get("code");
  if (!code) return oauthError(400, "invalid_request", "Kein Google-Code erhalten");

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.googleClientId,
      client_secret: cfg.googleClientSecret,
      redirect_uri: `${cfg.baseUrl}/oauth/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) {
    return oauthError(502, "server_error", "Google hat den Code nicht akzeptiert");
  }
  const google = (await tokenResponse.json()) as {
    refresh_token?: string;
    id_token?: string;
  };
  if (!google.refresh_token || !google.id_token) {
    return oauthError(502, "server_error", "Google hat keinen Refresh-Token geliefert");
  }

  // Der ID-Token kommt direkt von Google über TLS, daher reicht das Lesen der Claims.
  const claims = JSON.parse(
    Buffer.from(google.id_token.split(".")[1], "base64url").toString("utf8"),
  ) as { email?: string; email_verified?: boolean };
  if (
    !claims.email_verified ||
    (claims.email ?? "").toLowerCase() !== cfg.allowedEmail
  ) {
    return oauthError(403, "access_denied", "Dieses Google-Konto ist nicht freigeschaltet");
  }

  const authCode = signToken(cfg.tokenSecret, {
    typ: "code",
    ru: state.ru,
    cc: state.cc,
    gref: encryptSecret(cfg.tokenSecret, google.refresh_token),
    exp: nowSeconds() + CODE_TTL,
  });

  const back = new URL(state.ru);
  back.searchParams.set("code", authCode);
  if (state.st) back.searchParams.set("state", state.st);
  return { redirect: back.toString() };
}

function issueTokens(cfg: Config, gref: string) {
  const now = nowSeconds();
  return {
    access_token: signToken(cfg.tokenSecret, { typ: "access", gref, exp: now + ACCESS_TTL }),
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: signToken(cfg.tokenSecret, { typ: "refresh", gref, exp: now + REFRESH_TTL }),
    scope: "tasks",
  };
}

/** Schritt 3: Claude tauscht den Code (mit PKCE-Verifier) gegen Tokens. */
export function exchangeToken(cfg: Config, form: URLSearchParams): object | OAuthError {
  const grant = form.get("grant_type");

  if (grant === "authorization_code") {
    const code = verifyToken<{ typ: string; ru: string; cc: string; gref: string; exp: number }>(
      cfg.tokenSecret,
      form.get("code") ?? "",
    );
    if (!code || code.typ !== "code") {
      return oauthError(400, "invalid_grant", "Code ungültig oder abgelaufen");
    }
    if (form.get("redirect_uri") !== code.ru) {
      return oauthError(400, "invalid_grant", "redirect_uri stimmt nicht");
    }
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (!verifier || challenge !== code.cc) {
      return oauthError(400, "invalid_grant", "PKCE-Prüfung fehlgeschlagen");
    }
    return issueTokens(cfg, code.gref);
  }

  if (grant === "refresh_token") {
    const refresh = verifyToken<{ typ: string; gref: string; exp: number }>(
      cfg.tokenSecret,
      form.get("refresh_token") ?? "",
    );
    if (!refresh || refresh.typ !== "refresh") {
      return oauthError(400, "invalid_grant", "Refresh-Token ungültig oder abgelaufen");
    }
    return issueTokens(cfg, refresh.gref);
  }

  return oauthError(400, "unsupported_grant_type", "Nicht unterstützter grant_type");
}

/** Liefert den Google-Refresh-Token, wenn das Bearer-Token gültig ist. */
export function googleRefreshTokenFor(cfg: Config, authorization: string | undefined): string | null {
  const match = /^Bearer (.+)$/i.exec(authorization ?? "");
  if (!match) return null;
  const access = verifyToken<{ typ: string; gref: string; exp: number }>(cfg.tokenSecret, match[1]);
  if (!access || access.typ !== "access") return null;
  return decryptSecret(cfg.tokenSecret, access.gref);
}
