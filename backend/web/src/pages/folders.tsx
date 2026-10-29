import { toast } from "sonner";
import { FolderOpen, FolderPlus, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/bits";
import { Content, PageHead } from "@/components/shell";
import { ago, api, useApi, type FolderRow } from "@/lib/api";

/** Folders Remuse may use: upload from them, save downloads into them. Nothing outside these. */
export function FoldersPage() {
  const { data, reload } = useApi<FolderRow[]>("/folders", 10000, () => true);
  const { busy, run } = useAction();
  const add = () => run("add", async () => {
    toast("A folder picker opened on your screen. Choose a folder there.");
    const r = await api<{ cancelled?: boolean; name?: string }>("/folders/pick", "POST");
    if (!r.cancelled) toast.success(`Remuse can now use ${r.name}.`);
    reload();
  });
  const remove = (f: FolderRow) => run(f.id, async () => { await api(`/folders/${f.id}`, "DELETE"); toast(`Remuse won't use ${f.name} anymore.`); reload(); });

  return (
    <Content>
      <PageHead
        title="Folders"
        sub="Remuse uploads files from these and saves downloads into them, and never touches any other folder on your computer."
        actions={<Button className="rounded-full" onClick={add} disabled={!!busy}>{busy === "add" ? <LoaderCircle className="animate-spin" /> : <FolderPlus />}Add folder</Button>}
      />
      {!data ? <div className="h-20 animate-pulse rounded-2xl bg-muted" /> : data.length ? (
        <ul className="glass divide-y divide-rule overflow-hidden rounded-2xl">
          {data.map((f) => (
            <li key={f.id} className="flex items-center gap-4 px-5 py-3.5">
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{f.name}</p>
                <p className="truncate font-mono text-[12px] text-muted-foreground">{f.path}</p>
              </div>
              <p className="hidden max-w-[280px] text-right text-[13px] text-muted-foreground sm:block">
                {!f.ok ? <span className="text-warn">Can't open this folder</span> : f.latest
                  ? <>{f.count} files · newest <span className="text-foreground">{f.latest.name}</span>, {ago(f.latest.modified)}</> : "Empty"}
              </p>
              <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground" aria-label={`Stop using ${f.name}`} onClick={() => remove(f)} disabled={busy === f.id}><X /></Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="glass rounded-2xl px-6 py-10 text-center">
          <p className="font-medium">No folders yet</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-muted-foreground">Add the folder you keep posts in, for example one with files named like “2026-11-02 0900 launch.jpg”. Remuse can then post the next one on a schedule, with the caption from a .txt file of the same name.</p>
        </div>
      )}
    </Content>
  );
}
