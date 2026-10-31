// The voice is heard as English and Tagalog (Taglish), so Filipino speech isn't taken for Indonesian or Malay.
// No model calls. Run: node test/voice.check.ts
import { readFileSync } from "node:fs";
import { silent, transcribeRequest } from "../src/meta.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

delete process.env.VOICE_LANGUAGES;
check("by default it listens for English and Tagalog", JSON.stringify(transcribeRequest().languageBias) === '["English","Tagalog"]', transcribeRequest());
check("and still asks for turns with timings", transcribeRequest().mode === "ENDPOINTING" && transcribeRequest().audioEncoding === "WAV");
process.env.VOICE_LANGUAGES = "English, Spanish";
check("VOICE_LANGUAGES changes the languages", JSON.stringify(transcribeRequest().languageBias) === '["English","Spanish"]', transcribeRequest());
process.env.VOICE_LANGUAGES = "";
check("empty: no bias, the model decides", transcribeRequest().languageBias === undefined, transcribeRequest());

// Speech models make words up for silence ("Hello."): silent audio is never sent to them.
const wav = (secs: number, level: number) => {
  const n = 16000 * secs, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 7) * level * 32767 * 1.414), 44 + i * 2);
  return new Uint8Array(b);
};
check("digital silence is silent", silent(wav(2, 0)));
check("a quiet room is silent", silent(wav(2, 0.001)));
check("a soft voice is not", !silent(wav(2, 0.01)));
check("real speech is not", !silent(new Uint8Array(readFileSync(new URL("../../scripts/fixtures/teach.wav", import.meta.url)))));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
