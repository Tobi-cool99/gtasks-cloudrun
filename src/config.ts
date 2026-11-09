export interface Config {
  /** Öffentliche Basis-URL des Dienstes, z. B. https://gtasks-cloudrun-xyz-ew.a.run.app */
  baseUrl: string;
  port: number;
  googleClientId: string;
  googleClientSecret: string;
  /** Einzige Google-Adresse, die sich anmelden darf. */
  allowedEmail: string;
  /** Geheimnis zum Signieren und Verschlüsseln der Tokens (mind. 32 Zeichen). */
  tokenSecret: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return value;
}

export function loadConfig(): Config {
  const tokenSecret = required("TOKEN_SECRET");
  if (tokenSecret.length < 32) {
    throw new Error("TOKEN_SECRET muss mindestens 32 Zeichen lang sein");
  }
  return {
    baseUrl: required("PUBLIC_BASE_URL").replace(/\/+$/, ""),
    port: Number(process.env.PORT ?? 8080),
    googleClientId: required("GOOGLE_CLIENT_ID"),
    googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
    allowedEmail: required("ALLOWED_EMAIL").toLowerCase(),
    tokenSecret,
  };
}
