// When you start talking and when you've finished saying something, from the microphone's loudness, block by
// block. Used by offscreen.js; plain enough to run in node for the checks (backend/test/vad.check.ts).
const FLOOR = 0.006; // the quietest a voice can be and still count (a quiet mic or a soft voice)
const FLUSH = 15; // seconds of sound with no sentence cut: send it anyway (see "flush")

globalThis.makeVad = function makeVad() {
  const s = { speaking: false, loud: 0, quiet: 0, noise: 0.004, long: 0, idle: 0, sound: 0 };
  return {
    state: s,
    /** rms: one block's loudness; dt: its length in seconds. "start" when you start talking, "end" when you're done,
     *  "flush" when there was sound for a while that never became a sentence (send the last FLUSH seconds anyway). */
    step(rms, dt) {
      // The room's level: drops at once to anything quieter, creeps up over seconds, so a voice never becomes "the room".
      if (!s.speaking) s.noise += (rms - s.noise) * (rms < s.noise ? 0.05 : 0.0005);
      const voice = rms > Math.max(FLOOR, s.noise * 3);
      // Speech has tiny gaps between sounds: they only wear the count down, they don't reset it.
      if (voice) { s.loud += dt; s.quiet = 0; } else { s.quiet += dt; if (!s.speaking) s.loud = Math.max(0, s.loud - dt); }
      if (s.speaking) s.long += dt;
      else { s.idle += dt; if (rms > Math.max(0.003, s.noise * 1.5)) s.sound += dt; }
      if (!s.speaking && s.loud > 0.15) { s.speaking = true; s.long = s.loud + 0.4; s.idle = 0; s.sound = 0; return "start"; }
      // Someone who talks on and on still gets heard: after 12 s a short breath (0.3 s) ends it, and 20 s always does.
      if (s.speaking && (s.quiet > 1.2 || (s.long > 12 && s.quiet > 0.3) || s.long > 20)) { s.speaking = false; s.loud = 0; return "end"; }
      // A voice too faint to cut into sentences still gets heard: "I'm done" can't get lost.
      if (!s.speaking && s.idle > FLUSH && s.sound > 1.5) { s.idle = 0; s.sound = 0; return "flush"; }
      if (!s.speaking && s.idle > FLUSH) { s.idle = 0; s.sound = 0; }
      return null;
    },
    /** While Remuse talks, nothing is heard: not speaking, counts cleared. */
    reset() { s.speaking = false; s.loud = 0; s.quiet = 0; s.long = 0; s.idle = 0; s.sound = 0; },
  };
};
globalThis.VAD_FLUSH = FLUSH;
