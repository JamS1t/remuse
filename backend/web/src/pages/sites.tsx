import { Globe } from "lucide-react";
import { Content, PageHead } from "@/components/shell";
import { ago, useApi } from "@/lib/api";

/** Sites whose login Remuse may use. Connecting and disconnecting happens in Chrome, where the login lives. */
export function SitesPage() {
  const { data } = useApi<{ site: string; cookies: number; updatedAt: number }[]>("/logins", 5000, () => true);
  return (
    <Content>
      <PageHead title="Connected sites" sub="Remuse works on these with the login you already have in Chrome, even when Chrome is closed. Your login stays on this computer." />
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
      ) : <p className="glass rounded-2xl px-5 py-8 text-center text-muted-foreground">None yet.</p>}
      <p className="mt-4 text-[13px] text-muted-foreground">To connect a site, open it in Chrome, open the Remuse sidebar and choose “Use my login”. Disconnect it from the same place.</p>
    </Content>
  );
}
