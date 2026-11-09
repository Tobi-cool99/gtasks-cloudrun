// Lokaler Start über stdio (Claude Desktop / Claude Code). Die Cloud-Version
// liegt in src/http.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate } from "@google-cloud/local-auth";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";
import { buildServer } from "./server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keysPath = path.join(root, "gcp-oauth.keys.json");
const credentialsPath = path.join(root, ".gtasks-server-credentials.json");

async function runAuth() {
  const auth = await authenticate({
    keyfilePath: keysPath,
    scopes: ["https://www.googleapis.com/auth/tasks"],
  });
  fs.writeFileSync(credentialsPath, JSON.stringify(auth.credentials));
  console.log("Zugangsdaten gespeichert. Der Server kann jetzt gestartet werden.");
}

async function runStdio() {
  if (!fs.existsSync(credentialsPath)) {
    console.error("Keine Zugangsdaten gefunden. Bitte zuerst mit 'auth' starten.");
    process.exit(1);
  }
  const keys = JSON.parse(fs.readFileSync(keysPath, "utf8"));
  const client = keys.installed ?? keys.web;
  const oauth2 = new google.auth.OAuth2(client.client_id, client.client_secret);
  oauth2.setCredentials(JSON.parse(fs.readFileSync(credentialsPath, "utf8")));
  const tasks = google.tasks({ version: "v1", auth: oauth2 });

  const server = buildServer(tasks);
  await server.connect(new StdioServerTransport());
}

(process.argv[2] === "auth" ? runAuth() : runStdio()).catch(console.error);
