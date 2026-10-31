import { toast } from "sonner";
import { Globe, LoaderCircle, Plus } from "lucide-react";
import { Content, PageHead } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/bits";
import { ago, useApi, useGoogle } from "@/lib/api";

/** Sites whose login Remuse may use. Connecting and disconnecting happens in Chrome, where the login lives; Google is
 *  signed in to Remuse's own browser instead (never copied), one or more accounts, listed here. */
export function SitesPage() {
  const { data } = useApi<{ site: string; cookies: number; updatedAt: number }[]>("/logins", 5000, () => true);
  const g = useGoogle();
  const { busy, run } = useAction();
  const add = () => run("google", async () => {
    await g.add();
    toast("Sign in to Google in the window that opened, then close it. Google sees it as a new device, so nothing else gets signed out.", { duration: 12000 });
  });
  const accounts = g.data?.accounts ?? [];
  return (
    <Content>
      <PageHead title="Connected sites" sub="Remuse works on these with the login you already have in Chrome, even when Chrome is closed. Your login stays on this computer." />
      <ul className="glass mb-4 divide-y divide-rule overflow-hidden rounded-2xl">
        <li className="flex items-start gap-3 px-5 py-3.5">
          <Globe className="mt-0.5 size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <span className="font-medium">Google</span>
            <p className="text-[13px] text-muted-foreground">
              {!g.data ? "Checking…" : g.data.signedIn ? "Signed in to Remuse's own browser (never copied). Runs on Gmail, Docs, Sheets, YouTube and the rest act only as these:" : "Not signed in yet. Remuse signs in to Google in its own browser, never by copying your Chrome login."}
            </p>
            {accounts.length ? <ul className="mt-1.5 space-y-0.5 text-[13.5px]">{accounts.map((a) => <li key={a} className="truncate">{a}</li>)}</ul> : null}
            {g.waiting ? <p className="mt-1.5 text-[12.5px] text-muted-foreground">Waiting for you to sign in and close the Google window…</p> : null}
          </div>
          <Button size="sm" variant="outline" disabled={!!busy || g.waiting} onClick={add}>
            {busy === "google" || g.waiting ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {g.data?.signedIn ? "Add another account" : "Sign in to Google"}
          </Button>
        </li>
      </ul>
      {!data ? <div className="h-20 animate-pulse rounded-2xl bg-muted" /> : data.length ? (
        <ul className="glass divide-y divide-rule overflow-hidden rounded-2xl">
          {data.map((s) => (
            <li key={s.site} className="flex items-center gap-3 px-5 py-3.5">
              <Globe className="size-4 text-muted-foreground" />
              <span className="font-medium">{s.site}</span>
              <span className="ml-auto text-[13px] text-muted-foreground">login refreshed {ago(s.updatedAt)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="glass rounded-2xl px-5 py-8 text-center text-muted-foreground">No other sites yet.</p>}
      <p className="mt-4 text-[13px] text-muted-foreground">To connect another site, open it in Chrome, open the Remuse sidebar and choose “Use my login”. Disconnect it from the same place.</p>
    </Content>
  );
}
