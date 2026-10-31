// What Remuse says out loud after practicing on your example: the same facts as PracticeLines, as one short reply.
// Types only, so the checks can run it with plain node (backend/test/say.check.ts).
import type { PracticeState } from "./api";

const plain = (s: string) => s.replaceAll("_", " ");
const sentence = (s: string) => s.trim().replace(/[.\s]+$/, "");

export function practiceSay(p: PracticeState): string {
  const r = p.result;
  if (!r) return p.status === "stopped" ? "The practice stopped before it finished." : "The practice didn't finish.";
  if (r.problem) return `I got stuck: ${sentence(r.problem)}.`;
  const bad = r.values.find((v) => !v.ok);
  let say =
    bad ? (bad.got == null ? `I couldn't read ${plain(bad.name)}. You saw ${bad.want}.` : `I read ${plain(bad.name)} as ${bad.got}, but you saw ${bad.want}.`)
    : r.values.length ? `That worked. I read ${r.values.map((v) => `${plain(v.name)} ${v.got}`).join(", ")}.`
    : "That worked.";
  if (r.asked) say += ` On your example I'd ask you: ${sentence(r.asked)}?`.replace(/\?\?$/, "?");
  if (r.stoppedBefore) say += ` I stopped before "${sentence(r.stoppedBefore).replace(/^./, (c) => c.toLowerCase())}"; real runs wait for your OK there.`;
  return say;
}
