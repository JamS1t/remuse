// Step checks learned from a demo must not rest on the demo's own numbers (they change on the next run).
// No model calls. Run: node test/checks.check.ts
import { normalize, type Spec } from "../src/understand.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

// What Muse Spark learned from the YouTube analytics demo, plus a few checks that must stay as they are.
const step = (id: string, textIncludes: string, name?: string) => ({ id, do: "click", describe: id, target: name ? { role: "tab", name } : undefined, expect: { textIncludes, looks: "it worked" } });
const spec = {
  title: "Monitor video analytics", inputs: { source: "once", columns: [{ name: "order", describe: "order", demoValue: "KG-1042" }] },
  variables: [
    { name: "views", kind: "text", description: "views", demoValue: "2,595" },
    { name: "ctr", kind: "text", description: "ctr", demoValue: "5.0%" },
    { name: "average_view_duration", kind: "text", description: "avd", demoValue: "3:04" },
    { name: "views_change", kind: "computed", description: "change", demoValue: null },
  ],
  rules: [{ if: "otherwise", then: "report" }],
  outcomes: { report: { describe: "Report", steps: [] } },
  steps: [
    step("ctr", "5.0%", "Impressions click-through rate 5.0%"),
    step("avd", "3:04"),
    step("headline", "This video has had 2,595 views since it was published"),
    step("fixed", "Video analytics"),
    step("templated", "{{order}} refunded"),
    step("count", "Step 2 of 3"),
    step("order", "Order KG-1042 shipped"),
  ],
} as unknown as Spec;
normalize(spec, { id: "t", events: [], turns: [] } as any);
const t = (id: string) => spec.steps.find((s) => s.id === id)!.expect?.textIncludes;

check("a demo number with a label to click: the label is checked instead", t("ctr") === "Impressions click-through rate", t("ctr"));
check("a demo number with nothing else: the text check is dropped (\"looks\" stays)", t("avd") === undefined && spec.steps.find((s) => s.id === "avd")!.expect?.looks === "it worked", t("avd"));
check("a sentence with a demo number keeps its longest fixed words, all still on the page", t("headline") === "views since it was published" || t("headline") === "This video has had", t("headline"));
check("fixed words are left alone", t("fixed") === "Video analytics", t("fixed"));
check("a check with {{variables}} is left alone", t("templated") === "{{order}} refunded", t("templated"));
check("numbers that aren't the demo's data are left alone", t("count") === "Step 2 of 3", t("count"));
check("this item's own value from the list becomes {{column}}, so the next item's value is checked", t("order") === "Order {{order}} shipped", t("order"));

// Google Sheets' Name Box has no label to find it by: learning gives it the page's fixed id.
const nb = { ...spec, steps: [{ id: "n1", do: "fill", describe: "Go to A1", value: "A1", target: { role: "textbox", name: "Name Box" } }], outcomes: {} } as unknown as Spec;
normalize(nb, { id: "t", events: [], turns: [] } as any);
check("a Name Box step gets Sheets' fixed id", nb.steps[0].target?.selector === "#t-name-box", nb.steps[0].target);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
