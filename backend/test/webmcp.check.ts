// Check: a page's WebMCP tool, registered with navigator.modelContext, is visible to the Agent's browser
// and can be called the way the runner calls it. Run: node test/webmcp.check.ts
import { createServer } from "node:http";
import { openBrowser } from "../src/runner.ts";

const page = `<!doctype html><p id="out">nothing yet</p><script>
navigator.modelContext.registerTool({
  name: "add_note", description: "Add a note to the page",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  async execute({ text }) { document.getElementById("out").textContent = "note: " + text; return { content: [{ type: "text", text: "ok" }] }; },
});
</script>`;
const server = createServer((_, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page); }).listen(0);
const port = (server.address() as any).port;

const ctx = await openBrowser(true);
try {
  const p = ctx.pages()[0] ?? (await ctx.newPage());
  await p.goto(`http://127.0.0.1:${port}/`);
  const has = await p.evaluate(() => (window as any).__showrunTools?.has("add_note"));
  const out = await p.evaluate(async () => JSON.stringify(await (window as any).__showrunTools.get("add_note").execute({ text: "hello" }, {})));
  const text = await p.innerText("#out");
  console.log({ has, out, text });
  console.assert(has && text === "note: hello", "WebMCP tool not seen or not called");
} finally {
  await ctx.close();
  server.close();
}
