// Folders the person allowed. Remuse reads files to upload, and saves downloads, only inside these.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Kept with the rest of the Agent data (DATA_DIR in tests, so tests never touch your real folder list).
const DATA = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : fileURLToPath(new URL("../data", import.meta.url));
const FILE = join(DATA, "folders.json");
const USED = join(DATA, "uploaded.json");

export type Folder = { id: string; name: string; path: string };
export type FileInfo = { name: string; size: number; modified: number };
export type Pick = "next" | "newest" | "dated";
export type FileRule = { folder: string | null; pick?: Pick; ext?: string[] };

export const listFolders = (): Folder[] => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : []);
const save = (f: Folder[]) => writeFileSync(FILE, JSON.stringify(f, null, 2));

export function addFolder(path: string, name?: string): Folder {
  const p = resolve(path);
  if (!existsSync(p) || !statSync(p).isDirectory()) throw new Error("that folder doesn't exist");
  const list = listFolders();
  const have = list.find((f) => f.path.toLowerCase() === p.toLowerCase());
  if (have) return have;
  const f = { id: randomUUID().slice(0, 8), name: (name || basename(p)).trim().slice(0, 60), path: p };
  save([...list, f]);
  return f;
}
export const removeFolder = (id: string) => save(listFolders().filter((f) => f.id !== id));
/** By id or by name (Muse Spark refers to folders by name). */
export const findFolder = (ref: string | null | undefined) =>
  ref ? listFolders().find((f) => f.id === ref || f.name.toLowerCase() === ref.toLowerCase()) ?? null : null;

/** The Windows folder picker, shown on the person's screen by the Agent. */
export function pickFolder(): Promise<string | null> {
  const ps = `Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose a folder Remuse may use'
$d.UseDescriptionForTitle = $true
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }`;
  return new Promise((res) => execFile("powershell.exe", ["-NoProfile", "-STA", "-Command", ps], { windowsHide: false, timeout: 300_000 }, (err, out) => res(err ? null : out.trim() || null)));
}

const HIDDEN = /^(\.|~\$|desktop\.ini$|thumbs\.db$)/i;
/** Files directly in the folder (not subfolders), newest first. Captions (.txt) are listed too. */
export function filesIn(f: Folder): FileInfo[] {
  return readdirSync(f.path, { withFileTypes: true })
    .filter((d) => d.isFile() && !HIDDEN.test(d.name))
    .map((d) => { const s = statSync(join(f.path, d.name)); return { name: d.name, size: s.size, modified: s.mtimeMs }; })
    .sort((a, b) => b.modified - a.modified);
}

// Date and time labels in file names: 2026-10-30, 2026_10_30, 20261030, then an optional time like 0900 or 09-00.
const DATED = /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:[ T_-]+(\d{2})[-_.:h]?(\d{2}))?/;
function label(name: string): { day: string; minutes: number | null } | null {
  const m = DATED.exec(name);
  if (!m) return null;
  return { day: `${m[1]}-${m[2]}-${m[3]}`, minutes: m[4] ? Number(m[4]) * 60 + Number(m[5]) : null };
}

/** Which file to upload now. "next": oldest by name not uploaded before (a posting queue). "newest": the
 *  latest file to arrive. "dated": the file labelled with today's date, and the latest time label not
 *  after now. Captions (.txt) are never picked themselves. */
export function chooseFile(f: Folder, rule: FileRule, used: Set<string>, now = new Date()): string | null {
  const ext = rule.ext?.map((e) => e.replace(/^\./, "").toLowerCase());
  const candidates = filesIn(f).filter((x) => extname(x.name).toLowerCase() !== ".txt" && (!ext?.length || ext.includes(extname(x.name).slice(1).toLowerCase())));
  const pick = rule.pick ?? "next";
  if (pick === "newest") return candidates[0]?.name ?? null;
  const fresh = candidates.filter((x) => !used.has(x.name));
  if (pick === "next") return fresh.map((x) => x.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0] ?? null;
  const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const [h, mi] = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour12: false }).split(":").map(Number);
  const nowMin = h * 60 + mi;
  const due = fresh.map((x) => ({ x, l: label(x.name) })).filter(({ l }) => l?.day === today && (l.minutes === null || l.minutes <= nowMin));
  due.sort((a, b) => (b.l!.minutes ?? -1) - (a.l!.minutes ?? -1));
  return due[0]?.x.name ?? null;
}

/** Full path of a file in an allowed folder; refuses anything that would leave the folder. */
export function pathIn(f: Folder, name: string) {
  const p = resolve(f.path, basename(name));
  if (!p.startsWith(resolve(f.path) + sep)) throw new Error("file is outside the allowed folder");
  return p;
}

/** The caption: a .txt file with the same name as the upload, if there is one. */
export function captionFor(f: Folder, name: string): string | null {
  const txt = pathIn(f, name.replace(/\.[^.]+$/, "") + ".txt");
  return existsSync(txt) ? readFileSync(txt, "utf8").trim() : null;
}

// What each task already uploaded, so a scheduled post never repeats a file.
const usedAll = (): Record<string, string[]> => (existsSync(USED) ? JSON.parse(readFileSync(USED, "utf8")) : {});
export const usedFor = (task: string) => new Set(usedAll()[task] ?? []);
export function markUsed(task: string, names: string[]) {
  if (!names.length) return;
  const all = usedAll();
  all[task] = [...new Set([...(all[task] ?? []), ...names])];
  writeFileSync(USED, JSON.stringify(all, null, 2));
}

/** A free file name in the folder: "report.csv", then "report (2).csv", and so on. */
export function freeName(f: Folder, wanted: string) {
  const base = basename(wanted).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "download";
  const ext = extname(base), stem = base.slice(0, base.length - ext.length);
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${stem} (${i})${ext}`;
    if (!existsSync(join(f.path, name))) return join(f.path, name);
  }
}
