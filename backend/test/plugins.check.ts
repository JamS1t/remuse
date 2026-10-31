// What Remuse knows about particular sites lives in small plug-ins; the engine works without them. No model, no browser.
// Run: node test/plugins.check.ts
import { handleFor, pluginFor, sheetsVerdict } from "../src/plugins.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

check("Classroom by address", pluginFor("https://classroom.google.com/c/abc/a/def/details")?.name === "classroom");
check("Sheets by address", pluginFor("https://docs.google.com/spreadsheets/d/x/edit#gid=0")?.name === "sheets");
check("Docs isn't Sheets", pluginFor("https://docs.google.com/document/d/x")?.name !== "sheets");
check("a look-alike address isn't Classroom", pluginFor("https://classroom.google.com.evil.example/c/1")?.name !== "classroom");
check("unknown sites get none", pluginFor("https://example.com") === null);
check("a broken address gets none", pluginFor("not a url") === null);
const sheets = pluginFor("https://docs.google.com/spreadsheets/d/x")!;
check("Sheets knows the Name Box", sheets.handles?.find((h) => h.name.test("Name Box"))?.selector === "#t-name-box");
check("and the shortcut to it", !!sheets.routes?.find((r) => r.purpose.test("Go to the next empty row") && r.keys.includes("Control+J")));
check("Classroom keeps drafts", pluginFor("https://classroom.google.com/c/1")?.keepsDrafts === true);
check("a known handle is offered on any page (used only if it's really there)", handleFor("http://127.0.0.1:5000/sheet", "Name Box") === "#t-name-box");
check("no handle for ordinary names", handleFor("https://docs.google.com/spreadsheets/d/x", "Save") === null);

// Google Sheets draws its grid itself: a typed cell is read back from the formula bar, at the cell the Name Box shows.
const cell = { do: "fill", value: "451.00", describe: "Type the total" } as any;
const box = { do: "fill", value: "C12", describe: "Go to C12", target: { role: "textbox", name: "Name Box" } } as any;
check("a typed cell is proven by the formula bar", sheetsVerdict(cell, "D12", "451.00")?.result === "verified" && /D12 now holds “451\.00”/.test(sheetsVerdict(cell, "D12", "451.00")!.why));
check("a cell holding something else fails", sheetsVerdict(cell, "D12", "349.00")?.result === "failed");
check("going to a cell is proven by the Name Box", sheetsVerdict(box, "C12", "")?.result === "verified" && sheetsVerdict(box, "c12", null)?.result === "verified");
check("the Name Box at another cell fails", sheetsVerdict(box, "C13", "")?.result === "failed");
check("with nothing to read, Sheets can't tell (the engine decides)", sheetsVerdict(cell, null, null) === null);
check("other steps aren't the Sheets read-back's", sheetsVerdict({ do: "click", describe: "Archive" } as any, "C12", "x") === null);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
