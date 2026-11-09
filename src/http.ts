import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { google } from "googleapis";
import { loadConfig, Config } from "./config.js";
import {
  authorizationServerMetadata,
  exchangeToken,
  finishGoogleLogin,
  googleRefreshTokenFor,
  isOAuthError,
  OAuthError,
  protectedResourceMetadata,
  registerClient,
  startAuthorization,
} from "./oauth.js";
import { buildServer } from "./server.js";

const cfg = loadConfig();

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendOAuthError(res: http.ServerResponse, err: OAuthError) {
  sendJson(res, err.status, { error: err.error, error_description: err.error_description });
}

function sendHtml(res: http.ServerResponse, status: number, text: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta charset="utf-8"><p>${text}</p>`);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const text = await readBody(req);
  return text ? JSON.parse(text) : undefined;
}

async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.end();
    return;
  }

  const refreshToken = googleRefreshTokenFor(cfg, req.headers.authorization);
  if (!refreshToken) {
    res.writeHead(401, {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${cfg.baseUrl}/.well-known/oauth-protected-resource"`,
    });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  // Pro Anfrage ein eigener Google-Client mit den Rechten des angemeldeten Nutzers.
  const auth = new google.auth.OAuth2(cfg.googleClientId, cfg.googleClientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  const tasks = google.tasks({ version: "v1", auth });

  const mcp = buildServer(tasks);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // zustandslos
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    mcp.close();
  });

  await mcp.connect(transport);
  const body = await readJson(req);
  await transport.handleRequest(req, res, body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", cfg.baseUrl);
    const path = url.pathname;

    if (path === "/healthz") return sendJson(res, 200, { ok: true });

    if (path === "/.well-known/oauth-protected-resource") {
      return sendJson(res, 200, protectedResourceMetadata(cfg));
    }
    if (path === "/.well-known/oauth-authorization-server") {
      return sendJson(res, 200, authorizationServerMetadata(cfg));
    }

    if (path === "/register" && req.method === "POST") {
      const result = registerClient(await readJson(req));
      if (isOAuthError(result)) return sendOAuthError(res, result);
      return sendJson(res, 201, result);
    }

    if (path === "/authorize" && req.method === "GET") {
      const result = startAuthorization(cfg, url.searchParams);
      if (isOAuthError(result)) return sendOAuthError(res, result);
      res.writeHead(302, { Location: result.redirect });
      return res.end();
    }

    if (path === "/oauth/callback" && req.method === "GET") {
      const result = await finishGoogleLogin(cfg, url.searchParams);
      if (isOAuthError(result)) {
        return sendHtml(res, result.status, `Anmeldung fehlgeschlagen: ${result.error_description}`);
      }
      res.writeHead(302, { Location: result.redirect });
      return res.end();
    }

    if (path === "/token" && req.method === "POST") {
      const result = exchangeToken(cfg, new URLSearchParams(await readBody(req)));
      if (isOAuthError(result)) return sendOAuthError(res, result);
      return sendJson(res, 200, result);
    }

    if (path === "/mcp") return await handleMcp(req, res);

    sendJson(res, 404, { error: "not_found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "server_error" });
  }
});

server.listen(cfg.port, () => {
  console.log(`gtasks-cloudrun läuft auf Port ${cfg.port} (${cfg.baseUrl})`);
});

export type { Config };
