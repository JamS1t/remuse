// Check: cookies in Chrome's chrome.cookies shape survive saveLogin -> applyLogins -> a real request.
import { saveLogin, removeLogin, listLogins } from "../src/logins.ts";
import { openBrowser } from "../src/runner.ts";

saveLogin("httpbin.org", [
  { name: "sr_domain", value: "one", domain: ".httpbin.org", path: "/", hostOnly: false, secure: true, httpOnly: true, sameSite: "lax", expirationDate: Date.now() / 1000 + 3600 },
  { name: "sr_host", value: "two", domain: "httpbin.org", path: "/", hostOnly: true, secure: true, httpOnly: false, sameSite: "no_restriction" },
  { name: "sr_old", value: "expired", domain: ".httpbin.org", path: "/", hostOnly: false, secure: true, httpOnly: false, sameSite: "lax", expirationDate: 1 },
]);
console.log("listed:", JSON.stringify(listLogins()));
const ctx = await openBrowser(true);
try {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://httpbin.org/cookies");
  const got = JSON.parse(await page.innerText("body")).cookies;
  console.log("server saw:", JSON.stringify(got));
  console.assert(got.sr_domain === "one" && got.sr_host === "two" && !got.sr_old, "cookies did not round-trip");
} finally {
  await ctx.close();
  removeLogin("httpbin.org");
}
