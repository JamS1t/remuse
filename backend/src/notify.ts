// Windows notifications, so an approval reaches the person even when no Showrun page is open.
// Clicking one opens the run in the default browser.
import { spawn } from "node:child_process";

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function notify(title: string, body: string, url: string) {
  if (process.platform !== "win32" || process.env.SHOWRUN_NO_NOTIFY === "1") return;
  const toast = `<toast activationType="protocol" launch="${xml(url)}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual><actions><action content="Review" activationType="protocol" arguments="${xml(url)}"/></actions></toast>`;
  // PowerShell's own app id lets an unpackaged program show toasts. The XML goes in base64 so no quoting can break it.
  const b64 = Buffer.from(toast, "utf16le").toString("base64");
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))`;
  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", windowsHide: true }).on("error", () => {});
}
