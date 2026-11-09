# gtasks-cloudrun

Google-Tasks-MCP-Server, der auf **Google Cloud Run** läuft und sich über eine
**Custom Connector**-URL in claude.ai und der Claude-App (auch mobil) einbinden lässt.

Basis ist [zcaceres/gtasks-mcp](https://github.com/zcaceres/gtasks-mcp) (MIT, siehe `LICENSE`).

## Funktionsweise

- Der Server ist gleichzeitig sein eigener OAuth-Server für Claude (Discovery,
  dynamische Client-Registrierung, PKCE).
- Die Anmeldung läuft über Google. Nur die Adresse in `ALLOWED_EMAIL` wird zugelassen.
- Alle Tokens sind signiert bzw. verschlüsselt und im Token selbst enthalten.
  Der Server speichert nichts, daher übersteht er Neustarts von Cloud Run.
- Im Leerlauf (`min-instances=0`) laufen keine Instanzen und es entstehen keine Kosten.

## Endpunkte

| Pfad | Zweck |
|---|---|
| `/mcp` | MCP (Streamable HTTP), braucht Bearer-Token |
| `/.well-known/oauth-protected-resource` | Discovery |
| `/.well-known/oauth-authorization-server` | Discovery |
| `/register` | dynamische Client-Registrierung |
| `/authorize`, `/oauth/callback`, `/token` | OAuth-Ablauf |
| `/healthz` | Statusprüfung |

## Einrichtung

### 1. Google Cloud: Webanwendung-Client

In der Google Cloud Console unter **APIs & Dienste → Anmeldedaten** einen OAuth-Client
vom Typ **Webanwendung** anlegen. Als autorisierte Weiterleitungs-URI trägst du später ein:

```
<SERVICE-URL>/oauth/callback
```

`<SERVICE-URL>` ist die Adresse, die Cloud Run nach dem ersten Deployment anzeigt.

Den Zustimmungsbildschirm auf **In Produktion** setzen, sonst läuft die Anmeldung nach
etwa 7 Tagen ab.

### 2. Deployment

```bash
PROJECT_ID=<deine-projekt-id>
REGION=europe-west3
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# Geheimnisse (nie in Git oder in den Chat)
openssl rand -hex 32 | gcloud secrets create gtasks-token-secret --data-file=-
printf '%s' '<CLIENT_SECRET_DES_WEB_CLIENTS>' | gcloud secrets create gtasks-google-client-secret --data-file=-

# Erstes Deployment mit Platzhalter für PUBLIC_BASE_URL
gcloud run deploy gtasks-cloudrun --source . --region "$REGION" \
  --allow-unauthenticated --min-instances=0 --max-instances=1 --memory=512Mi --cpu=1 \
  --set-env-vars="GOOGLE_CLIENT_ID=<CLIENT_ID>,ALLOWED_EMAIL=<deine-gmail-adresse>,PUBLIC_BASE_URL=https://placeholder.invalid" \
  --set-secrets="TOKEN_SECRET=gtasks-token-secret:latest,GOOGLE_CLIENT_SECRET=gtasks-google-client-secret:latest"

# Echte Adresse eintragen
SERVICE_URL=$(gcloud run services describe gtasks-cloudrun --region "$REGION" --format='value(status.url)')
gcloud run services update gtasks-cloudrun --region "$REGION" --update-env-vars="PUBLIC_BASE_URL=$SERVICE_URL"
echo "$SERVICE_URL"
```

Danach die ausgegebene Adresse als Weiterleitungs-URI im Web-Client eintragen (siehe oben).

### 3. Claude verbinden

In claude.ai unter **Einstellungen → Connectors → Benutzerdefinierten Connector hinzufügen**
die Adresse `<SERVICE-URL>/mcp` eintragen und dich mit deinem Google-Konto anmelden.
Die mobile App übernimmt den Connector.

### 4. Lokal testen

```bash
bun install
export PUBLIC_BASE_URL=http://localhost:8080 PORT=8080 GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
       ALLOWED_EMAIL=... TOKEN_SECRET=$(openssl rand -hex 32)
bun run start
```

Der lokale Modus über stdio (`bun run start:stdio`) braucht `gcp-oauth.keys.json` und
`bun run auth`, wie im Original beschrieben.

## Änderungen gegenüber dem Original

- HTTP-Transport (Streamable HTTP) und OAuth-Server für die Claude-App.
- Anmeldung über Google, Zugriff nur für eine festgelegte Adresse.
- Zustandslose Tokens, damit Cloud Run den Container stoppen darf.
- Tool-Logik (`Tasks.ts`) unverändert.

## Sicherheit

- `TOKEN_SECRET` und den Client-Secret nur über Secret Manager setzen.
- Mit `--max-instances=1` bleibt die Kapazität klein.
- Jeder, der die URL kennt, kann den Login-Ablauf starten, kommt ohne freigeschaltetes
  Google-Konto aber nicht an die Tasks.
