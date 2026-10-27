// Same-origin check for browser writes. Kept free of server-only imports so it can be unit tested.
const loopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function normalize(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
/** Origins this server answers on: its own URL, the Host the browser used, and APP_ORIGIN. */
export function allowedOrigins(request: Request, env: Record<string, string | undefined> = process.env): Set<string> {
  const allowed = new Set<string>();
  const add = (value: string | undefined) => {
    const origin = value && normalize(value);
    if (origin) allowed.add(origin);
  };
  const own = new URL(request.url);
  add(own.origin);
  // The Host header is what the browser actually connected to (e.g. 127.0.0.1 or a LAN IP),
  // even when Next.js reports another address such as localhost or 0.0.0.0.
  // Only IP literals and localhost: a domain name here could be DNS rebinding, so domains go in APP_ORIGIN.
  const host = request.headers.get("host");
  if (host) {
    const hostname = normalize(`${own.protocol}//${host}`) && new URL(`${own.protocol}//${host}`).hostname;
    if (hostname && (loopback.has(hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")))
      add(`${own.protocol}//${host}`);
  }
  for (const value of (env.APP_ORIGIN || "").split(",")) add(value.trim());
  return allowed;
}
export function originAllowed(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const header = request.headers.get("origin");
  // Non-browser clients and same-origin GETs may omit Origin; cookies are SameSite=Lax.
  if (!header) return true;
  const origin = normalize(header);
  if (!origin) return false;
  const allowed = allowedOrigins(request, env);
  if (allowed.has(origin)) return true;
  // In development, localhost, 127.0.0.1 and ::1 on the same port are the same machine.
  if (env.NODE_ENV !== "production") {
    const a = new URL(origin);
    return [...allowed].some((value) => {
      const b = new URL(value);
      return loopback.has(a.hostname) && loopback.has(b.hostname) && a.port === b.port && a.protocol === b.protocol;
    });
  }
  return false;
}
