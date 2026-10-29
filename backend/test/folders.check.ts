// Check: which file an upload picks (next / newest / dated), captions, and that nothing leaves the folder.
// Uses a throwaway folder; never touches the person's allowed folders. Run: node test/folders.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captionFor, chooseFile, freeName, pathIn, type Folder } from "../src/folders.ts";

const dir = mkdtempSync(join(tmpdir(), "remuse-folder-"));
const f: Folder = { id: "t", name: "Posts", path: dir };
const files: [string, number][] = [
  ["2026-10-29 0900 sunrise.jpg", 1], ["2026-10-30 0900 coffee.jpg", 2], ["2026-10-30 1500 sunset.jpg", 3], ["notes.png", 4],
];
for (const [name, age] of files) { writeFileSync(join(dir, name), "x"); utimesSync(join(dir, name), age, age * 1000); }
writeFileSync(join(dir, "2026-10-30 0900 coffee.txt"), "Morning brew ☕ #coffee\n");

const at = (iso: string) => new Date(iso); // Manila is UTC+8
const none = new Set<string>();

assert.equal(chooseFile(f, { folder: "Posts", pick: "next" }, none), "2026-10-29 0900 sunrise.jpg", "next = oldest by name");
assert.equal(chooseFile(f, { folder: "Posts", pick: "next" }, new Set(["2026-10-29 0900 sunrise.jpg"])), "2026-10-30 0900 coffee.jpg", "next skips what was already uploaded");
assert.equal(chooseFile(f, { folder: "Posts", pick: "newest" }, none), "notes.png", "newest = latest to arrive");
assert.equal(chooseFile(f, { folder: "Posts", pick: "newest", ext: ["jpg"] }, none), "2026-10-30 1500 sunset.jpg", "file types filter");
assert.equal(chooseFile(f, { folder: "Posts", pick: "dated" }, none, at("2026-10-30T02:00:00Z")), "2026-10-30 0900 coffee.jpg", "dated at 10:00 -> the 09:00 post");
assert.equal(chooseFile(f, { folder: "Posts", pick: "dated" }, none, at("2026-10-30T08:00:00Z")), "2026-10-30 1500 sunset.jpg", "dated at 16:00 -> the 15:00 post");
assert.equal(chooseFile(f, { folder: "Posts", pick: "dated" }, none, at("2026-10-29T23:30:00Z")), null, "dated at 07:30 -> nothing due yet");
assert.equal(chooseFile(f, { folder: "Posts", pick: "dated" }, new Set(["2026-10-30 1500 sunset.jpg"]), at("2026-10-30T08:00:00Z")), "2026-10-30 0900 coffee.jpg", "dated skips uploaded");
assert.equal(captionFor(f, "2026-10-30 0900 coffee.jpg"), "Morning brew ☕ #coffee", "caption from the .txt twin");
assert.equal(captionFor(f, "notes.png"), null);
assert.ok(!["2026-10-30 0900 coffee.txt"].includes(chooseFile(f, { folder: "Posts", pick: "newest" }, none)!), "captions are never uploaded");
assert.ok(pathIn(f, "../../evil.txt").startsWith(dir), "names can't leave the folder");
assert.ok(freeName(f, "notes.png").endsWith("notes (2).png"), "downloads never overwrite");
console.log("folders: all checks pass");
