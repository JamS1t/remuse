// When a step fails, Remuse works out another way toward the step's goal. What a try may and may never do, how the
// loop reads the model's answer, remembers what failed, and where it starts. No model, no browser.
// Run: node test/recover.check.ts
import { canRecover, diagnose, firstRung, parseMove, repeated, unsafe, type Seen } from "../src/recover.ts";
import type { Step } from "../src/understand.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

const click = { id: "s2", do: "click", describe: "Attach your work", target: { role: "button", name: "Add or create" } } as Step;
const fill = { id: "s3", do: "fill", describe: "Go to C4", value: "C4", target: { role: "textbox", name: "Name Box" } } as Step;
const enter = { id: "s4", do: "press", describe: "Select it", key: "Enter", target: { role: "textbox", name: "Name Box" } } as Step;
const el = (i: number, role: string, name: string, editable = false): Seen => ({ i, role, name, editable, where: "top left" });
const here = "https://classroom.google.com/c/1/a/2/details";
const sig = { signin: false, overlay: false, loading: false, width: 1280, urlMatches: true, targetHidden: false };

// Steps that wait for your OK are never worked around: they wait for you.
check("a step that sends is never worked around", !canRecover({ ...click, describe: "Send the reply", target: { role: "button", name: "Send" } } as Step));
check("nor Turn in", !canRecover({ ...click, describe: "Turn it in", target: { role: "button", name: "Turn in" } } as Step));
check("a step marked irreversible is never worked around", !canRecover({ ...click, irreversible: true } as Step));
check("an ordinary step can be", canRecover(click) && canRecover(fill) && canRecover(enter));

// What a try may do.
check("opening a menu is fine", unsafe({ action: "click", el: 1, why: "" }, el(1, "button", "Add attachment"), click, [], here) === null);
check("clicking Send never is", unsafe({ action: "click", el: 2, why: "" }, el(2, "button", "Send"), click, [], here) !== null);
check("nor Delete, Submit, Pay or Turn in", ["Delete", "Submit", "Pay now", "Turn in"].every((n) => unsafe({ action: "click", el: 3, why: "" }, el(3, "menuitem", n), click, [], here) !== null));
check("nothing that isn't on the page", unsafe({ action: "click", el: 9, why: "" }, undefined, click, [], here) !== null);
check("typing goes only into something that takes typing", unsafe({ action: "fill", el: 4, why: "" }, el(4, "toolbar", "Search the menus"), fill, [], here) !== null && unsafe({ action: "fill", el: 5, why: "" }, el(5, "textbox", "", true), fill, [], here) === null);
check("Enter only when the step's own group pressed it", unsafe({ action: "press", key: "Enter", why: "" }, undefined, click, [], here) !== null && unsafe({ action: "press", key: "Enter", why: "" }, undefined, fill, ["Enter"], here) === null);
check("no Ctrl+Enter or other sending keys", unsafe({ action: "press", key: "Control+Enter", why: "" }, undefined, enter, ["Enter"], here) !== null);
check("other keys, scrolling and waiting are fine", unsafe({ action: "press", key: "Escape", why: "" }, undefined, click, [], here) === null && unsafe({ action: "scroll", why: "" }, undefined, click, [], here) === null && unsafe({ action: "wait", why: "" }, undefined, click, [], here) === null);
check("leaving the site is refused", unsafe({ action: "click", el: 1, why: "" }, el(1, "link", "Help"), click, [], here, "https://evil.example/x") !== null);
check("staying on the site is fine", unsafe({ action: "click", el: 1, why: "" }, el(1, "link", "Lab 5"), click, [], here, "https://classroom.google.com/c/1/a/5") === null);
check("an unknown action is refused", unsafe({ action: "goto", why: "" } as any, undefined, click, [], here) !== null);
// Keys: only moving around is allowed, plus the step's own keys; keys that act on the page never are.
check("Delete, Backspace and Space are refused", ["Delete", "Backspace", "Space", " "].every((k) => unsafe({ action: "press", key: k, why: "" }, undefined, click, [], here) !== null));
check("single-letter site shortcuts are refused (Gmail's e archives, # deletes)", ["e", "#", "Shift+3"].every((k) => unsafe({ action: "press", key: k, why: "" }, undefined, click, [], here) !== null));
check("moving around is allowed", ["Escape", "Tab", "Shift+Tab", "ArrowDown", "PageDown", "Home", "End"].every((k) => unsafe({ action: "press", key: k, why: "" }, undefined, click, [], here) === null));
check("the step's own group keys are allowed", unsafe({ action: "press", key: "Control+End", why: "" }, undefined, enter, ["Control+End", "Enter"], here) === null);
check("typing only on a step that types", unsafe({ action: "fill", el: 5, why: "" }, el(5, "textbox", "Search", true), click, [], here) !== null);
check("a nameless target is refused (its name can't be checked)", unsafe({ action: "click", el: 6, why: "" }, el(6, "button", ""), click, [], here) !== null);
check("another site on the same ending is still another site", unsafe({ action: "click", el: 1, why: "" }, el(1, "link", "Shop"), click, [], "https://a.co.uk/x", "https://b.co.uk/y") !== null);
check("another Google site is another site", unsafe({ action: "click", el: 1, why: "" }, el(1, "link", "Account"), click, [], here, "https://accounts.google.com/x") !== null);

// Reading the model's answer: anything odd is a failed try, never a click.
check("broken JSON is a failed attempt, not a click", parseMove("not json", 10).action === "none");
check("an element number that isn't on the list is refused", parseMove('{"action":"click","el":99,"why":"x"}', 10).action === "none");
check("a good answer is read", (() => { const m = parseMove('Here: {"action":"click","el":3,"why":"the + menu does the same job"}', 10); return m.action === "click" && m.el === 3 && /\+ menu/.test(m.why); })());
check("\"none of these\" is read as none", parseMove('{"action":"none","why":"nothing fits"}', 10).action === "none");

// Memory: the same idea on the same target isn't tried twice.
check("the same idea on the same target isn't tried twice", repeated([{ rung: 5, strategy: "click", target: "Add or create", changed: false, verdict: "failed", why: "" }], "click", "Add or create"));
check("a different target is a new idea", !repeated([{ rung: 5, strategy: "click", target: "Add or create", changed: false, verdict: "failed", why: "" }], "click", "Add attachment"));

// Where it starts, and what it says first.
check("a narrow window is said so", diagnose({ ...sig, width: 640 }).kind === "narrow");
check("an overlay is found first", diagnose({ ...sig, overlay: true, width: 640 }).kind === "overlay");
check("an overlay starts at rung 2", firstRung({ kind: "overlay", say: "" }) === 2);
check("still loading starts at rung 1", firstRung({ kind: "loading", say: "" }) === 1);
check("a missing target starts at rung 3", firstRung({ kind: "missing", say: "" }) === 3);
check("each diagnosis says something", diagnose(sig).say.length > 10);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
