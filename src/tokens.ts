import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/*
 * Zustandslose Tokens: Alles, was der Server später braucht (inklusive des
 * verschlüsselten Google-Refresh-Tokens), steckt im Token selbst. Dadurch
 * übersteht die Anmeldung, dass Cloud Run den Container zwischendurch stoppt.
 */

const enc = (secret: string) => createHash("sha256").update(`enc:${secret}`).digest();
const mac = (secret: string) => createHash("sha256").update(`mac:${secret}`).digest();

export function encryptSecret(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", enc(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString("base64url");
}

export function decryptSecret(secret: string, data: string): string {
  const buf = Buffer.from(data, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const body = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", enc(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export function signToken(secret: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", mac(secret)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Gibt die Nutzlast zurück, wenn Signatur und Ablaufzeit stimmen, sonst null. */
export function verifyToken<T extends { exp: number }>(secret: string, token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", mac(secret)).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: T;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
  return payload;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function randomId(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
