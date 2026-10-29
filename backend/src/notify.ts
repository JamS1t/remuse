// Windows notifications, so an update or an approval reaches the person even when no Remuse page is open.
// Clicking one opens the run in the default browser. They come from "Remuse", with the Remuse icon.
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP_ID = "Remuse.Agent";
const ICON = fileURLToPath(new URL("../../brand/app-icon/remuse-app-icon-512.png", import.meta.url));
const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

// An unpackaged program can show notifications under its own name once its app id is registered for the
// current user (no admin rights). Done once per Agent start; harmless to repeat.
let registered = false;
function register() {
  if (registered) return;
  registered = true;
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
  try {
    execFileSync("reg", ["add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", "Remuse", "/f"], { stdio: "ignore", windowsHide: true });
    if (existsSync(ICON)) execFileSync("reg", ["add", key, "/v", "IconUri", "/t", "REG_SZ", "/d", ICON, "/f"], { stdio: "ignore", windowsHide: true });
  } catch { /* the notification still shows, just without the name and icon */ }
}

export function notify(title: string, body: string, url: string) {
  if (process.platform !== "win32" || process.env.SHOWRUN_NO_NOTIFY === "1") return;
  register();
  const toast = `<toast activationType="protocol" launch="${xml(url)}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual><actions><action content="Open" activationType="protocol" arguments="${xml(url)}"/></actions></toast>`;
  // The XML goes in base64 so no quoting in the text can break the command.
  const b64 = Buffer.from(toast, "utf16le").toString("base64");
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`;
  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true }).on("error", () => {});
}
