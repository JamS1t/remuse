// One-time grant: the offscreen recorder can't show Chrome's permission prompt, this tab can.
navigator.mediaDevices.getUserMedia({ audio: true }).then(
  (s) => {
    s.getTracks().forEach((t) => t.stop());
    document.getElementById("msg").textContent = "Done. Close this tab, then stop and start the recording again to include your voice.";
  },
  (e) => { document.getElementById("msg").textContent = `Microphone blocked (${e.name}). Allow it in the address bar, then reload this page.`; },
);
