// Runs on Chrome's audio thread: hands each block of microphone samples, with its time, to offscreen.js.
registerProcessor("remuse-recorder", class extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage({ at: currentTime, pcm: ch.slice() });
    return true;
  }
});
