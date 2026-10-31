// What Remuse says when it reads a learned task back to you: plain sentences built from the task itself (no model,
// so it says exactly what it will do). The plan first, then its questions, which the review asks one at a time.
import type { Spec } from "./understand.ts";

export type Line = { text: string; step?: string; question?: string };

const sentence = (s: string) => s.trim().replace(/[.\s]+$/, "");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MAX = 8; // a plan read aloud stops being listened to after about this many steps

export function readback(spec: Spec): { plan: Line[]; questions: Line[] } {
  const steps = [...spec.steps, ...Object.values(spec.outcomes ?? {}).flatMap((o) => o.steps)];
  const plan: Line[] = [{ text: "Here's my plan." }];
  steps.slice(0, MAX).forEach((s, i) => plan.push({ text: `Step ${i + 1}: ${sentence(s.describe)}.`, step: s.id }));
  if (steps.length > MAX) plan.push({ text: `And ${steps.length - MAX} more steps, all on the screen.` });
  for (const r of spec.rules ?? []) {
    const then = lower(sentence(spec.outcomes?.[r.then]?.describe ?? r.then.replaceAll("_", " ")));
    if (r.said && /^(if|when|otherwise)\b/i.test(r.said.trim())) plan.push({ text: `${upper(sentence(r.said))}.` }); // their whole rule, as they said it
    else if (r.said) plan.push({ text: `If ${sentence(r.said)}, I'll ${then}.` });
    else if (!/^\s*otherwise\b/i.test(r.if)) plan.push({ text: `If ${sentence(r.if.replaceAll("_", " "))}, I'll ${then}.` });
  }
  const questions = (spec.questions ?? []).map((q) => ({ text: q.quote ? `One thing: you said "${sentence(q.quote)}". ${q.text}` : q.text, question: q.id }));
  return { plan, questions };
}
