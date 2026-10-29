// One-time grant: the offscreen recorder can't show Chrome's permission prompt, this tab can.
// Once allowed, Remuse closes this tab, goes back to your page and starts recording.
navigator.mediaDevices.getUserMedia({ audio: true }).then(
  (s) => {
    s.getTracks().forEach((t) => t.stop());
    document.getElementById("msg").textContent = "Thanks. Taking you back and starting the recording…";
    chrome.runtime.sendMessage({ type: "micGranted" });
  },
  (e) => { document.getElementById("msg").textContent = `The microphone is blocked (${e.name}). Click the icon at the right of the address bar, choose Allow, then reload this page.`; },
);
