const $ = (id) => document.getElementById(id);
const call = (type, extra) => chrome.runtime.sendMessage({ type, ...extra });

function show(text, err = false) { $("status").textContent = text; $("status").className = err ? "err" : ""; }

async function render() {
  const s = await call("status");
  $("toggle").textContent = s.recording ? "Stop recording" : "Start recording";
  $("toggle").className = s.recording ? "stop" : "";
  $("title").disabled = s.recording;
  if (s.recording) show(s.rec.audioError ? `Recording without voice: ${s.rec.audioError}` : "Recording. Do the task and talk through your choices.", !!s.rec.audioError);
  else if (s.last) show(`Last session: ${s.last.events} events, ${s.last.turns} spoken turns.${s.last.error ? `\nProblem: ${s.last.error}` : ""}`, !!s.last.error);
  return s;
}

$("toggle").onclick = async () => {
  $("toggle").disabled = true;
  const { recording } = await call("status");
  if (recording) show("Stopping and transcribing…");
  const r = await call(recording ? "stop" : "start", { title: $("title").value.trim() || undefined });
  $("toggle").disabled = false;
  if (r?.error) return show(r.error.includes("fetch") ? "Backend not running. Start it with: cd backend && npm start" : r.error, true);
  render();
};

render();
