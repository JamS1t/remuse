// Logins the Chrome helper shares for the sites the person connected. Kept on this PC only (data/ is
// gitignored), handed to the Agent's browser before each run so nobody has to sign in twice.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "playwright";

const FILE = fileURLToPath(new URL("../data/logins.json", import.meta.url));

// Shape of chrome.cookies.Cookie, the fields we use.
export type ChromeCookie = {
  name: string; value: string; domain: string; path: string; hostOnly: boolean;
  secure: boolean; httpOnly: boolean; sameSite: string; expirationDate?: number;
};
type Store = Record<string, { cookies: ChromeCookie[]; updatedAt: number }>;

const read = (): Store => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {});
const write = (s: Store) => writeFileSync(FILE, JSON.stringify(s));

export const SITE = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

export function saveLogin(site: string, cookies: ChromeCookie[]) {
  const s = read();
  s[site] = { cookies, updatedAt: Date.now() };
  write(s);
}
export function removeLogin(site: string) {
  const s = read();
  delete s[site];
  write(s);
}
/** What the UI may see: which sites are connected, never the cookie values. */
export const listLogins = () => Object.entries(read()).map(([site, v]) => ({ site, cookies: v.cookies.length, updatedAt: v.updatedAt }));

/** Google signs the account out on every device when its login turns up in a second browser, so a Google
 *  login is never copied. The person signs in once in Remuse's own browser instead (a new device to Google). */
export const GOOGLE = /^(google[.][a-z.]+|youtube[.]com|gmail[.]com|blogger[.]com)$/;

const SAME_SITE: Record<string, "Strict" | "Lax" | "None"> = { strict: "Strict", lax: "Lax", no_restriction: "None" };

/** Put every connected site's login into a Playwright browser. */
export async function applyLogins(ctx: BrowserContext) {
  const now = Date.now() / 1000;
  const all = Object.values(read()).flatMap((v) => v.cookies).filter((c) => !c.expirationDate || c.expirationDate > now);
  if (!all.length) return 0;
  await ctx.addCookies(all.map((c) => {
    const base = { name: c.name, value: c.value, path: c.path || "/", secure: c.secure, httpOnly: c.httpOnly,
      sameSite: SAME_SITE[c.sameSite] ?? ("Lax" as const), expires: c.expirationDate ?? -1 };
    // Host-only cookies belong to one exact host; Playwright takes those as a URL.
    if (c.hostOnly) { const { path, ...rest } = base; return { ...rest, url: `https://${c.domain.replace(/^\./, "")}${path}` }; }
    return { ...base, domain: c.domain.startsWith(".") ? c.domain : `.${c.domain}` };
  }).map((c) => (c.sameSite === "None" ? { ...c, secure: true } : c)));
  return all.length;
}
