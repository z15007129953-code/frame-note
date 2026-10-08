"use client";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "./i18n";
type Link = { id: string; expiresAt: string; revoked: boolean; allowComments: boolean };
type Props = {
  presentationId: string; busy: boolean;
  request: (path: string, options?: RequestInit) => Promise<any>;
  execute: (work: () => Promise<void>) => Promise<void>;
};
export default function ShareManager({ presentationId, busy, request, execute }: Props) {
  const { t } = useLanguage();
  const [links, setLinks] = useState<Link[]>([]), [loading, setLoading] = useState(true);
  const [hours, setHours] = useState("1"), [error, setError] = useState("");
  const [allowComments, setAllowComments] = useState(false);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState("");
  const alive = useRef(true);
  const executor = useRef(execute);
  executor.current = execute;
  const endpoint = `/api/shares?presentationId=${presentationId}`;
  useEffect(() => {
    alive.current = true;
    let active = true;
    void executor.current(async () => {
      try { const value = await request(endpoint); if (active) setLinks(value); }
      catch (e) { if (active) { setError("Share links could not be loaded. Try again."); throw e; } }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; alive.current = false; };
  }, [endpoint, request]);
  async function action(work: () => Promise<void>) {
    await execute(async () => {
      setError("");
      try { await work(); }
      catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Please try again."); throw e; }
    });
  }
  return <section className="share-manager" aria-label="Share presentation">
    <div><p className="eyebrow">{t("invite")}</p><h3>{t("share")}</h3></div>
    <p className="note">{t("shareHelp")}</p>
    <div className="share-create">
      <label>{t("linkDuration")}<select aria-label={t("linkDuration")} value={hours} disabled={busy} onChange={e => setHours(e.target.value)}>
        <option value="1">{t("hour")}</option><option value="24">{t("hours")}</option>
      </select></label>
      <button className="secondary" disabled={busy || loading} onClick={() => action(async () => {
        const link = await request("/api/shares", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ presentationId, hours: Number(hours), allowComments }) });
        setCreated({ id: link.id, url: `${location.origin}/share/${link.id}#${link.token}` });
        setCopied("");
        setLinks(await request(endpoint));
      })}>{t("createLink")}</button>
    </div>
    <label className="share-comments-option"><input type="checkbox" checked={allowComments} disabled={busy || loading} onChange={e => setAllowComments(e.target.checked)} /> {t("allowGuests")}</label>
    <p className="note">{t("shareLimit")}</p>
    {created && <div className="share-created">
      <label htmlFor="new-share-link">{t("newLink")}</label>
      <input id="new-share-link" aria-label="New share link" readOnly value={created.url} onFocus={e => e.target.select()} />
      <div><button className="secondary" disabled={busy} onClick={async () => {
        try { await navigator.clipboard.writeText(created.url); setCopied("Link copied."); }
        catch { setCopied("Copy was blocked. Select and copy the link above."); }
      }}>{t("copy")}</button></div>
      <p className="note">{t("copyNow")}</p>
      {copied && <p role="status">{copied}</p>}
    </div>}
    {error && <div role="alert"><p>{error}</p><button className="quiet" disabled={busy} onClick={() => action(async () => { setLinks(await request(endpoint)); setLoading(false); })}>Retry share links</button></div>}
    {loading ? <p role="status">{t("loadingLinks")}</p> : <ul className="share-list">
      {links.map((link, i) => <li key={link.id}>
        <span>{t("link")} {i + 1}<small>{t("expires")} {new Date(link.expiresAt).toLocaleString()}</small></span>
        {link.revoked ? <span>{t("revoked")}</span> : <><span>{link.allowComments ? t("commentsOn") : t("readOnly")}</span><button className="quiet" disabled={busy} onClick={() => action(async () => {
          await request(`/api/shares/${link.id}`, { method: "DELETE" });
          if (created?.id === link.id) { setCreated(null); setCopied(""); }
          setLinks(await request(endpoint));
        })}>{t("revoke")}</button></>}
      </li>)}
    </ul>}
  </section>;
}
