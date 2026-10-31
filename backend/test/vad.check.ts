// The speech detector must keep hearing a person who talks on and on, softly, or over a noisy room: otherwise
// "I'm done" is never sent and Remuse keeps listening. No model, no browser. Run: node test/vad.check.ts
import "../../extension/vad.js";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

const DT = 128 / 48000; // one block, as Chrome's audio thread hands them over
// Run a vad over [loudness, seconds] pieces; returns when each sentence started and ended. A little jitter on each
// block, as a real mic has.
function run(pieces: [number, number][], seed = 1) {
  const vad = (globalThis as any).makeVad();
  let t = 0, r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const ev: [string, number][] = [];
  for (const [rms, secs] of pieces) for (let i = 0; i < secs / DT; i++) { const e = vad.step(rms * (0.6 + 0.8 * rand()), DT); t += DT; if (e) ev.push([e, +t.toFixed(1)]); }
  return { ends: ev.filter(([e]) => e === "end").map(([, x]) => x), all: ev };
}
// Talking for `secs`, in phrases of `phrase` s with `gap` s breaths between them.
const talk = (level: number, secs: number, phrase = 1.8, gap = 0.25, room = 0.004): [number, number][] => {
  const out: [number, number][] = [];
  for (let t = 0; t < secs; t += phrase + gap) out.push([level, phrase], [room, gap]);
  return out;
};

const normal = run([[0.004, 2], [0.05, 3], [0.004, 2]]);
check("a sentence, then a pause: heard as one", normal.ends.length === 1, normal.all);

// James's case: talks on for 40 s with short breaths, then says "I'm done" and stops.
for (const level of [0.05, 0.025, 0.016]) {
  const r = run([[0.004, 1], ...talk(level, 40), [level, 1], [0.004, 2]]);
  check(`a steady talker at ${level} is still heard at the end`, r.ends.at(-1)! > 41, r.all);
}
// A room with a fan or traffic, someone talking over it.
const noisy = run([[0.009, 3], ...talk(0.04, 40, 1.8, 0.25, 0.009), [0.04, 1], [0.009, 2]]);
check("over a noisy room, the last sentence is still heard", noisy.ends.at(-1)! > 43, noisy.all);
// A quiet room again after loud talking: a sentence is heard as soon as it ends.
const back = run([[0.004, 2], [0.05, 2], [0.004, 3], [0.03, 1.5], [0.004, 2]]);
check("a quieter second sentence after a pause is heard", back.ends.length === 2, back.all);

// Real speech, not steady tones: 45 s of nonstop narration, then "Okay, that's it.", at a few mic volumes, over a
// little room noise. The detector must end a sentence after "that's it" (the clip is quiet after it).
{
  const { readFileSync } = await import("node:fs");
  const wav = (f: string) => { const b = readFileSync(new URL(`../../scripts/fixtures/${f}`, import.meta.url)); const n = (b.length - 44) >> 1; const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + 2 * i) / 32768; return x; };
  const talkClip = wav("narration.wav"), endClip = wav("teach.wav").slice(16000 * 9.5); // from just before "Okay, that's it."
  const blockN = 128 / 3; // 128 samples at 48 kHz = 42.7 samples at 16 kHz
  for (const gain of [1, 0.4, 0.3, 0.25, 0.2, 0.15]) {
    const vad = (globalThis as any).makeVad();
    let t = 0, r = 7; const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const ends: number[] = [];
    const feed = (x: Float32Array, reps = 1) => { for (let k = 0; k < reps; k++) for (let i = 0; i + blockN < x.length; i += blockN) {
      let s = 0; const a = Math.floor(i), b = Math.floor(i + blockN);
      for (let j = a; j < b; j++) { const v = x[j] * gain + (rand() - 0.5) * 0.006; s += v * v; }
      t += DT; if (vad.step(Math.sqrt(s / (b - a)), DT) === "end") ends.push(+t.toFixed(1));
    } };
    feed(talkClip, 3); const talkedTill = t; feed(endClip);
    check(`real speech at volume ${gain}: the last sentence ("that's it") is heard`, ends.length > 0 && ends.at(-1)! > talkedTill, { ends, talkedTill: +talkedTill.toFixed(1) });
  }
}

// A quiet room with the odd click is not a sentence.
{
  const vad = (globalThis as any).makeVad();
  let starts = 0, r = 3;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 30 / DT; i++) if (vad.step(0.003 * (0.5 + rand()) + (i % 4000 === 0 ? 0.05 : 0), DT) === "start") starts++;
  check("a quiet room with the odd click starts no sentence", starts === 0, starts);
}
// Safety net: a mic so faint that no sentence is ever cut still sends what it picked up, at least every 15 s, so
// "I'm done" gets through.
const faint = run([[0.003, 1], ...talk(0.0055, 40, 1.8, 0.25, 0.003)], 5);
check("a voice too faint to cut sentences is still sent every 15 s", faint.all.filter(([e]) => e === "flush").length >= 2, faint.all);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
