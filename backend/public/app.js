// Showrun UI: recordings -> Task Spec review -> build -> run with approvals. No framework.
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (ms) => new Date(ms).toLocaleString();
const secs = (ms) => (ms / 1000).toFixed(1) + " s";

async function api(path, method = "GET", body) {
  const res = await fetch("/api" + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Busy button + error display for slow model calls.
async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label; btn.classList.add("spin");
  try { return await fn(); }
  catch (e) { alert(e.message); }
  finally { btn.disabled = false; btn.textContent = old; btn.classList.remove("spin"); }
}

document.addEventListener("click", (e) => {
  const img = e.target.closest("img[data-zoom]");
  if (!img) return;
  const d = document.getElementById("zoom");
  d.querySelector("img").src = img.src;
  d.showModal();
});

let timer = null;
async function route() {
  clearTimeout(timer);
  const [, view, id] = location.hash.split("/");
  try {
    if (view === "session") await sessionView(id);
    else if (view === "spec") await specView(Number(id));
    else if (view === "run") await runView(id);
    else await home();
  } catch (e) { $app.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
addEventListener("hashchange", route);
route();

// ---------- Home ----------
async function home() {
  const [sessions, runs] = await Promise.all([api("/sessions"), api("/runs")]);
  $app.innerHTML = `
    <h1>Teach it a task</h1>
    <p class="sub">Click the Showrun icon in Chrome, press <b>Start recording</b>, do the task once while saying your reasons out loud, then press <b>Stop</b>. Your recording shows up here.</p>
    <h2>Recordings</h2>
    ${sessions.length ? `<div class="card"><table><tr><th>Task</th><th>Recorded</th><th>Events</th><th></th></tr>
      ${sessions.map((s) => `<tr><td><a href="#/session/${s.id}">${esc(s.title || "Untitled task")}</a></td><td>${when(s.started_at)}</td><td>${s.events}</td>
        <td>${s.latest_spec ? `<a href="#/spec/${s.latest_spec}">Task Spec</a>` : ""}</td></tr>`).join("")}</table></div>`
      : `<p class="sub">No recordings yet.</p>`}
    <h2>Runs</h2>
    ${runs.length ? `<div class="card"><table><tr><th>Started</th><th>Status</th><th>Items</th><th>Matched</th></tr>
      ${runs.map((r) => `<tr><td><a href="#/run/${r.id}">${when(r.startedAt)}</a></td><td>${esc(r.status)}</td><td>${r.items}</td><td>${r.score ? `${r.score.matched}/${r.score.total}` : ""}</td></tr>`).join("")}</table></div>`
      : `<p class="sub">No runs yet.</p>`}`;
}

// ---------- Session: what was recorded ----------
async function sessionView(id) {
  const s = await api(`/sessions/${id}`);
  const img = (f) => f ? `<img data-zoom src="/api/sessions/${id}/files/${f}" alt="screenshot">` : "";
  const rows = [
    ...s.events.map((e) => ({ t: e.t, html: `<tr><td>${secs(e.t)}</td><td><span class="chip">${esc(e.kind)}</span>
      ${e.target ? `${esc(e.target.role || e.target.tag)} <b>${esc(e.target.label || e.target.text || "")}</b>` : esc(e.url)}
      ${e.value !== undefined ? ` = “${esc(e.value)}”` : ""}</td><td class="thumbs">${img(e.before)}${img(e.after)}</td></tr>` })),
    ...s.turns.map((v) => ({ t: v.startMs, html: `<tr class="voice"><td>${secs(v.startMs)}</td><td colspan="2">🎙 “${esc(v.text)}”</td></tr>` })),
  ].sort((a, b) => a.t - b.t);
  $app.innerHTML = `
    <p><a href="#/">← All recordings</a></p>
    <h1>${esc(s.title || "Untitled task")}</h1>
    <p class="sub">Recorded ${when(s.started_at)} · ${s.events.length} events · ${s.turns.length} spoken turns${s.transcribe_error ? ` · <span class="err">voice: ${esc(s.transcribe_error)}</span>` : ""}</p>
    <div class="card row">
      <button class="primary" id="mk">Write the Task Spec (Muse Spark)</button>
      ${s.specs.length ? `<span>or open: ${s.specs.map((x) => `<a href="#/spec/${x.id}">v${x.version}</a>`).join(" · ")}</span>` : ""}
    </div>
    <h2>What you did and said</h2>
    <div class="card"><table class="timeline">${rows.map((r) => r.html).join("")}</table></div>`;
  document.getElementById("mk").onclick = (e) => busy(e.target, "Muse Spark is watching your recording (about a minute)", async () => {
    const spec = await api(`/sessions/${id}/spec`, "POST");
    location.hash = `#/spec/${spec.id}`;
  });
}

// ---------- Task Spec review ----------
const KIND = { text: "read by code", vision: "looked at (photo)", judge: "judged from text", computed: "computed" };

function stepsHtml(steps) {
  return `<ol class="steps">${steps.map((s) => `<li>${esc(s.describe)}
    ${s.target?.name && s.do !== "open_item" ? ` <span class="chip">${esc(s.target.role || "")} “${esc(s.target.name)}”</span>` : ""}
    ${s.do === "fill" && s.value ? ` <span class="chip">types ${esc(s.value)}</span>` : ""}
    ${s.vars ? s.vars.map((v) => `<span class="chip">${esc(v)}</span>`).join("") : ""}
    ${s.irreversible ? ` <span class="chip gate">waits for your OK</span>` : ""}
    ${s.healed ? ` <span class="chip heal">updated: ${esc(s.healed)}</span>` : ""}</li>`).join("")}</ol>`;
}

async function specView(id) {
  const row = await api(`/specs/${id}`);
  const s = row.spec;
  const item = s.inputs?.itemName || "item";
  const tests = row.tests || [];
  $app.innerHTML = `
    <p><a href="#/session/${row.sessionId}">← Recording</a></p>
    <h1>${esc(s.goal)}</h1>
    <p class="sub">Task Spec v${row.version} · ${esc(row.note || "")}</p>

    <div class="card"><b>Scope.</b> ${esc(s.scope)}<br>
      ${(s.scopeTypes || []).map((t) => `<span class="chip ok">${esc(t)}</span>`).join("")} <span class="sub">Anything else: I stop and ask you.</span></div>

    <h2>For every ${esc(item)} in <a href="${esc(s.inputs.listUrl)}" target="_blank">${esc(s.inputs.listUrl)}</a></h2>
    <div class="card">${stepsHtml(s.steps)}</div>

    <h2>What I read on the way</h2>
    <div class="card"><table><tr><th>Name</th><th>How</th><th>What it is</th><th>In your demo</th></tr>
      ${s.variables.map((v) => `<tr><td><b>${esc(v.name)}</b></td><td><span class="chip">${KIND[v.kind] || v.kind}</span></td><td>${esc(v.description)}${v.question ? `<br><span class="quote">${esc(v.question)}</span>` : ""}</td><td>${esc(JSON.stringify(v.demoValue))}</td></tr>`).join("")}</table></div>

    <h2>Your rules <span class="sub">(first match wins)</span></h2>
    <div class="card"><ol class="steps">${s.rules.map((r) => `<li>If <b>${esc(r.if)}</b> → <b>${esc(r.then)}</b>
      ${r.said ? `<br><span class="quote">You said: “${esc(r.said)}”</span>` : ""} ${r.learned ? `<span class="chip learn">learned from you</span>` : ""}</li>`).join("")}</ol></div>

    <h2>What each decision does</h2>
    ${Object.entries(s.outcomes).map(([k, o]) => `<div class="card"><b>${esc(k)}</b>: ${esc(o.describe)}
      ${o.demonstrated ? `<span class="chip ok">you showed this</span>` : `<span class="chip inf">inferred from the screen, check it</span>`}
      ${stepsHtml(o.steps)}${o.reply ? `<p><span class="sub">Reply:</span> “${esc(o.reply)}”</p>` : ""}</div>`).join("")}

    <div class="card row"><button id="edit">Edit the spec</button><span class="sub">Saving makes a new version; build the rules again after.</span></div>
    <div id="editor" hidden class="card"><textarea class="json" id="json"></textarea><div class="row" style="margin-top:8px"><button class="primary" id="save">Save as new version</button></div></div>

    <h2>Rules as code</h2>
    <div class="card">
      <div class="row"><button class="primary" id="build">${row.code ? "Build again" : "Build the rules into code"} (Muse Spark)</button>
      ${row.code ? `<span class="${tests.every((t) => t.ok) ? "okc" : "err"}">${tests.filter((t) => t.ok).length}/${tests.length} checks pass</span>` : `<span class="sub">Dates, thresholds and rule order are run as tested code, not guessed by a model.</span>`}</div>
      ${row.code ? `<details style="margin-top:10px"><summary>Checks against your demo</summary><table>${tests.map((t) => `<tr><td>${t.ok ? "✓" : "✗"}</td><td>${esc(t.name)}</td><td class="sub">${esc(t.detail)}</td></tr>`).join("")}</table></details>
        <details><summary>The code</summary><pre>${esc(row.code)}</pre></details>` : ""}
    </div>

    <h2>Run it</h2>
    <div class="card">
      <div class="row">
        <label>How many ${esc(item)}s <input type="number" id="limit" min="1" placeholder="all" style="width:90px"></label>
        <label><input type="checkbox" id="auto"> Approve every refund/send in advance</label>
        <button class="primary" id="run" ${row.code ? "" : "disabled title='Build the rules first'"}>Run on the list</button>
      </div>
      <p class="sub" style="margin:10px 0 0">Demo controls (mock apps):
        <button id="reset">Reset demo data</button> <button id="v1">Store layout: original</button> <button id="v2">Store layout: redesigned</button></p>
    </div>`;

  document.getElementById("edit").onclick = () => {
    const ed = document.getElementById("editor"); ed.hidden = !ed.hidden;
    document.getElementById("json").value = JSON.stringify(s, null, 2);
  };
  document.getElementById("save").onclick = (e) => busy(e.target, "Saving", async () => {
    const spec = JSON.parse(document.getElementById("json").value);
    const r = await api(`/specs/${id}`, "PUT", { spec });
    location.hash = `#/spec/${r.id}`;
  });
  document.getElementById("build").onclick = (e) => busy(e.target, "Muse Spark is writing and testing the code", async () => { await api(`/specs/${id}/build`, "POST"); route(); });
  document.getElementById("run").onclick = (e) => busy(e.target, "Starting", async () => {
    const limit = document.getElementById("limit").value;
    const r = await api(`/specs/${id}/runs`, "POST", { limit: limit || undefined, autoApprove: document.getElementById("auto").checked });
    location.hash = `#/run/${r.id}`;
  });
  document.getElementById("reset").onclick = (e) => busy(e.target, "Resetting", () => api("/mock/reset", "POST"));
  document.getElementById("v1").onclick = (e) => busy(e.target, "Switching", () => api("/mock/layout?v=v1", "POST"));
  document.getElementById("v2").onclick = (e) => busy(e.target, "Switching", () => api("/mock/layout?v=v2", "POST"));
}

// ---------- Run ----------
const ICON = { waiting: "·", running: "▶", approval: "✋", asking: "?", done: "✓", skipped: "–", failed: "✗" };
let selected = null;
let answeredFor = null;

async function runView(id) {
  const r = await api(`/runs/${id}`);
  const live = !["done", "failed", "stopped"].includes(r.status);
  const shot = (f) => f ? `<img data-zoom src="/api/runs/${id}/files/${f}" alt="screen">` : "";
  const sel = selected ?? Math.min(r.current, r.items.length - 1);
  const it = r.items[sel];
  const done = r.items.filter((i) => ["done", "skipped", "failed"].includes(i.status)).length;
  const p = r.pending;
  const pendingKey = p ? `${p.kind}-${p.item}-${p.shot}` : null;
  const keepForm = p && answeredFor === pendingKey && document.getElementById("pending");

  const pendingHtml = !p ? "" : p.kind === "approval" ? `
    <div class="card pending" id="pending"><h2 style="margin-top:0">✋ Waiting for your OK</h2>
      <p><b>${esc(r.items[p.item].label)}</b><br>About to: <b>${esc(p.step)}</b>${p.target ? ` (“${esc(p.target)}”)` : ""}</p>
      <p>Decision: <b>${esc(p.outcome)}</b>, because ${esc(p.because)}</p>
      ${p.healed ? `<p class="warnc">${esc(p.healed)}</p>` : ""}
      ${shot(p.shot)}
      <div class="row" style="margin-top:10px"><button class="good" data-a="approve">Approve</button><button data-a="approve_all">Approve all remaining</button><button class="bad" data-a="reject">No, skip this one</button></div></div>` : `
    <div class="card pending ask" id="pending"><h2 style="margin-top:0">? I need you</h2>
      <p>${esc(p.question)}</p>
      <div class="row"><label style="flex:1">Do this <select id="out">${p.options.map((o) => `<option>${esc(o)}</option>`).join("")}<option value="">skip it</option></select></label></div>
      <p><label>Why (I'll remember it) <input type="text" id="note" placeholder="e.g. wrong item: ship the right one"></label></p>
      <p><label>Reply to send instead of the usual one (optional, {{variables}} work) <textarea id="reply" rows="3"></textarea></label></p>
      <label><input type="checkbox" id="learn" checked> Do the same for similar ${esc("emails")} without asking</label>
      <div class="row" style="margin-top:10px"><button class="primary" id="answer">Do it</button></div>
      ${shot(p.shot)}</div>`;

  if (!keepForm) {
    $app.innerHTML = `
      <p><a href="#/spec/${r.specId}">← Task Spec</a>${r.newSpecId ? ` · <a href="#/spec/${r.newSpecId}">New spec version from this run</a>` : ""}</p>
      <div class="row" style="justify-content:space-between">
        <div><h1>Run ${live ? `<span class="spin"></span>` : ""}</h1><p class="sub">${esc(r.status)} · ${done}/${r.items.length} done${r.autoApprove ? " · approving in advance" : ""}${r.error ? ` · <span class="err">${esc(r.error)}</span>` : ""}</p></div>
        <div>${r.score ? `<span class="score">${r.score.matched}/${r.score.total}</span> <span class="sub">match the right answer</span>` : ""} ${live ? `<button class="bad" id="stop">Stop</button>` : ""}</div>
      </div>
      ${pendingHtml}
      <div class="run">
        <div class="card" style="padding:0"><ul class="items">${r.items.map((i, n) => `<li data-i="${n}" class="${n === sel ? "sel" : ""}"><span>${ICON[i.status] || ""}</span>
          <div><div class="lbl">${esc(i.label)}</div><div class="out">${esc(i.outcome || i.status)}${i.decidedBy && i.decidedBy !== "rules" ? ` · ${i.decidedBy === "you" ? "you decided" : "learned from you"}` : ""}${i.expected && i.outcome ? ((i.expected === "ask" ? i.decidedBy !== "rules" : i.outcome === i.expected) ? " ✓" : ` ✗ expected ${esc(i.expected)}`) : ""}</div></div></li>`).join("")}</ul></div>
        <div>
          ${r.heals.length || r.learned.length ? `<div class="card">${r.heals.map((h) => `<div><span class="chip heal">layout changed</span> “${esc(h.from)}” is now “${esc(h.to)}”</div>`).join("")}
            ${r.learned.map((l) => `<div><span class="chip learn">learned</span> ${esc(l.requestType)} → ${esc(l.outcome)}${l.note ? `: ${esc(l.note)}` : ""}</div>`).join("")}</div>` : ""}
          ${it ? `<div class="card"><b>${esc(it.label)}</b>${it.because ? `<p>Decision: <b>${esc(it.outcome)}</b>, because ${esc(it.because)}</p>` : ""}
            <ul class="log">${it.log.map((l) => `<li class="${l.level}">${esc(l.msg)}${l.shot ? ` <a href="/api/runs/${id}/files/${l.shot}" target="_blank">screen</a>` : ""}</li>`).join("")}</ul></div>` : ""}
          ${live && r.shot ? `<div class="card screen"><span class="sub">Latest screen</span>${shot(r.shot)}</div>` : ""}
        </div>
      </div>`;
    answeredFor = p ? pendingKey : null;
    $app.querySelectorAll(".items li").forEach((li) => li.onclick = () => { selected = Number(li.dataset.i); route(); });
    $app.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => busy(b, "Sending", async () => { await api(`/runs/${id}/answer`, "POST", { decision: b.dataset.a }); route(); }));
    const ans = document.getElementById("answer");
    if (ans) ans.onclick = () => busy(ans, "Sending", async () => {
      await api(`/runs/${id}/answer`, "POST", { outcome: document.getElementById("out").value || undefined, note: document.getElementById("note").value || undefined,
        reply: document.getElementById("reply").value || undefined, learn: document.getElementById("learn").checked });
      route();
    });
    const stop = document.getElementById("stop");
    if (stop) stop.onclick = () => busy(stop, "Stopping", () => api(`/runs/${id}/stop`, "POST"));
  }
  if (live) timer = setTimeout(route, 1000);
}
