// A recording is learned as moments: one sentence and what was done around it, or a run of silent actions.
// No model calls. Run: node test/moments.check.ts
import { moments } from "../src/moments.ts";
import { buildPrompt } from "../src/understand.ts";
import { fileURLToPath } from "node:url";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

const ev = (t: number, kind: string, tab = 1) => ({ t, kind, tab, url: "https://studio.youtube.com/" });
const events = [ev(0, "start"), ev(2000, "click"), ev(9000, "click"), ev(30000, "click"), ev(31000, "point"), ev(32000, "tools"), ev(33000, "page", 2)];
const turns = [{ startMs: 1500, endMs: 4000, text: "open analytics" }, { startMs: 8800, endMs: 10000, text: "read views" }];
const m = moments({ events, turns });

check("a click while talking belongs to that sentence", m.find((x) => x.said === "open analytics")!.events.includes(1), m);
check("a click inside the next sentence's window goes to that sentence", m.find((x) => x.said === "read views")!.events.includes(2), m);
check("a click long after the talking is its own silent moment", m.some((x) => x.said === null && x.events.includes(3)), m);
check("point and tools events are never in a moment", !m.some((x) => x.events.includes(4) || x.events.includes(5)), m);
check("a page in a tab never clicked or typed in is left out", !m.some((x) => x.events.includes(6)), m);
check("the start screen before any talking is a silent moment", m[0].said === null && m[0].events.includes(0), m[0]);
check("moments are in time order", m.every((x, i) => i === 0 || m[i - 1].from <= x.from), m.map((x) => x.from));
const quiet = moments({ events: [ev(0, "start")], turns: [{ startMs: 500, endMs: 900, text: "hi" }, { startMs: 60_000, endMs: 61_000, text: "bye" }] });
check("a sentence with nothing done is still a moment", quiet.some((x) => x.said === "bye" && x.events.length === 0), quiet);

// What Muse Spark reads: moment headers with the words, event lines under them, no resting-mouse lines.
const prompt = buildPrompt({ id: "x", events, turns } as any, ".").filter((p: any) => p.type === "input_text").map((p: any) => p.text).join("\n");
check("the prompt reads moment by moment, with what was said", /Moment \d \([\d.]+-[\d.]+s\) said: "open analytics"\n#1 /.test(prompt), prompt.slice(-600));
check("and never shows where the mouse rested", !/ point /.test(prompt));
// A drawn mark: what it circled, in words, and the instruction that it points at something on purpose.
const marked = buildPrompt({ id: "x", events: [ev(0, "start"), { ...ev(2500, "mark"), shape: "circle", targets: [{ role: undefined, label: undefined, text: "Views 2,607" }] }], turns } as any, ".").filter((p: any) => p.type === "input_text").map((p: any) => p.text).join("\n");
check("a mark shows its shape and what it circled", /#1 t=2\.5s mark shape=circle .*"Views 2,607"/.test(marked), marked.split("\n").filter((l) => l.includes("mark")).join(" | ").slice(0, 300));
check("Muse Spark is told what a mark means", /a mark is the person circling or underlining something on purpose/i.test(marked));
// Hopping to a tab only to read it (nothing clicked there): the switch keeps that tab in the recording, with its picture.
const hop = [ev(0, "start", 1), ev(2000, "click", 1), { ...ev(4000, "tab", 2), url: "https://docs.google.com/spreadsheets/d/x", after: "courier.png" }]; // any real picture
const hm = moments({ events: hop, turns: [{ startMs: 3800, endMs: 6000, text: "and this is where the views go" }] });
check("a switch to another tab is part of the moment", hm.some((x) => x.said === "and this is where the views go" && x.events.includes(2)), hm);
const hopParts = buildPrompt({ id: "x", events: hop, turns: [] } as any, fileURLToPath(new URL("../../scripts/fixtures", import.meta.url)));
const hopPrompt = hopParts.filter((p: any) => p.type === "input_text").map((p: any) => p.text).join("\n");
check("with a picture of the tab it switched to", /frame: event #2, after/.test(hopPrompt) && hopParts.some((p: any) => p.type === "input_image"));
check("Muse Spark sees the switch, in its own tab", /#2 t=4\.0s tab tab=T2 url=https:\/\/docs\.google\.com/.test(hopPrompt), hopPrompt.split("\n").filter((l) => l.includes(" tab")).join(" | "));
check("and is told what a switch means", /a "tab" line is the person switching to another open tab/i.test(hopPrompt));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
