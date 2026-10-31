// The voice is heard as English and Tagalog (Taglish), so Filipino speech isn't taken for Indonesian or Malay.
// No model calls. Run: node test/voice.check.ts
import { transcribeRequest } from "../src/meta.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

delete process.env.VOICE_LANGUAGES;
check("by default it listens for English and Tagalog", JSON.stringify(transcribeRequest().languageBias) === '["English","Tagalog"]', transcribeRequest());
check("and still asks for turns with timings", transcribeRequest().mode === "ENDPOINTING" && transcribeRequest().audioEncoding === "WAV");
process.env.VOICE_LANGUAGES = "English, Spanish";
check("VOICE_LANGUAGES changes the languages", JSON.stringify(transcribeRequest().languageBias) === '["English","Spanish"]', transcribeRequest());
process.env.VOICE_LANGUAGES = "";
check("empty: no bias, the model decides", transcribeRequest().languageBias === undefined, transcribeRequest());

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
