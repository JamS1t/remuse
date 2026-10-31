// Saying you're done must end the recording right away, not after the note-taking queue (James waited half a
// minute behind slow note-taking calls). Stand-in models, no network. Run: node test/live.check.ts
import { heard, liveState } from "../src/live.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

// One second of a tone (not silence, so it isn't skipped as quiet).
const wav = (() => { const n = 16000, b = Buffer.alloc(44 + n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 7) * 3000), 44 + i * 2); return new Uint8Array(b); })();
const said = (text: string) => async () => ({ transcript: text, turns: [{ startMs: 0, endMs: 1000, text }] });
const slowNotes = () => new Promise<any>((r) => setTimeout(() => r({ ops: [], control: null }), 3000));
const session = () => ({ events: [] });
const deps = (text: string, extra: object = {}) => ({ transcribe: said(text), noteTake: slowNotes, confirmEnd: async () => true, ...extra });

// A queue of slow notes, then a clear "I'm done".
heard("a", wav, 0, session, deps("the first metric is the views"));
heard("a", wav, 1000, session, deps("the second one is the CTR"));
let t = Date.now();
const a = await heard("a", wav, 2000, session, deps("so that will be my task I'm done", { confirmEnd: async () => { throw new Error("a clear one isn't checked"); } }));
check("a clear \"I'm done\" ends it at once, not after the notes queue", a.control === "done" && Date.now() - t < 500, { a, ms: Date.now() - t });

// A loose one ("proceed") gets its own quick check, also not behind the queue.
heard("b", wav, 0, session, deps("the first metric is the views"));
let asked = "";
t = Date.now();
const b = await heard("b", wav, 1000, session, deps("proceed", { confirmEnd: async (s: string) => { asked = s; return true; } }));
check("a loose \"proceed\" is checked on its own, quickly", b.control === "done" && asked === "proceed" && Date.now() - t < 500, { b, asked, ms: Date.now() - t });

// The check says no: it's an ordinary sentence and becomes a note like any other.
let noted = "";
const c = await heard("c", wav, 0, session, deps("okay go ahead", { confirmEnd: async () => false, noteTake: async (_cards: unknown, moment: string) => { noted = moment; return { ops: [], control: null }; } }));
await new Promise((r) => setTimeout(r, 50));
check("when the check says no, it's just a sentence (noted as usual)", c.control === null && /okay go ahead/.test(noted), { c, noted });

// "Never mind" is checked too (it throws the recording away).
const d = await heard("d", wav, 0, session, deps("never mind", { confirmEnd: async (_s: string, kind: string) => kind === "cancel" }));
check("\"never mind\" is checked, then cancels", d.control === "cancel", d);

// The sidebar sees "finishing" as soon as a done is heard, before anything else happens.
heard("e", wav, 0, session, deps("proceed", { confirmEnd: () => new Promise((r) => setTimeout(() => r(true), 300)) }));
await new Promise((r) => setTimeout(r, 50));
check("the sidebar knows it's finishing while it checks", liveState("e")?.ending === "proceed", liveState("e"));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
