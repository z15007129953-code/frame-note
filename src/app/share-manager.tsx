"use client";
import { useEffect, useRef, useState } from "react";
type Link = { id: string; expiresAt: string; revoked: boolean };
type Props = {
  presentationId: string; busy: boolean;
  request: (path: string, options?: RequestInit) => Promise<any>;
  execute: (work: () => Promise<void>) => Promise<void>;
};
export default function ShareManager({ presentationId, busy, request, execute }: Props) {
  const [links, setLinks] = useState<Link[]>([]), [loading, setLoading] = useState(true);
  const [hours, setHours] = useState("1"), [error, setError] = useState("");
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
    <div><p className="eyebrow">Invite a closer look</p><h3>Share presentation</h3></div>
    <p className="note">Anyone with the link can view all current and future versions in this presentation. No comments or editing. Local preview links work only on this computer.</p>
    <div className="share-create">
      <label>Link duration<select aria-label="Link duration" value={hours} disabled={busy} onChange={e => setHours(e.target.value)}>
        <option value="1">1 hour</option><option value="24">24 hours</option>
      </select></label>
      <button className="secondary" disabled={busy || loading} onClick={() => action(async () => {
        const link = await request("/api/shares", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ presentationId, hours: Number(hours) }) });
        setCreated({ id: link.id, url: `${location.origin}/share/${link.id}#${link.token}` });
        setCopied("");
        setLinks(await request(endpoint));
      })}>Create view-only link</button>
    </div>
    <p className="note">Expires no later than this demo. Maximum 20 links per presentation, including revoked links.</p>
    {created && <div className="share-created">
      <label htmlFor="new-share-link">New share link</label>
      <input id="new-share-link" readOnly value={created.url} onFocus={e => e.target.select()} />
      <div><button className="secondary" disabled={busy} onClick={async () => {
        try { await navigator.clipboard.writeText(created.url); setCopied("Link copied."); }
        catch { setCopied("Copy was blocked. Select and copy the link above."); }
      }}>Copy link</button></div>
      <p className="note">Copy it now. The full link will not be shown again after you leave or refresh.</p>
      {copied && <p role="status">{copied}</p>}
    </div>}
    {error && <div role="alert"><p>{error}</p><button className="quiet" disabled={busy} onClick={() => action(async () => { setLinks(await request(endpoint)); setLoading(false); })}>Retry share links</button></div>}
    {loading ? <p role="status">Loading share links…</p> : <ul className="share-list">
      {links.map((link, i) => <li key={link.id}>
        <span>Link {i + 1}<small>Expires {new Date(link.expiresAt).toLocaleString()}</small></span>
        {link.revoked ? <span>Revoked</span> : <button className="quiet" disabled={busy} onClick={() => action(async () => {
          await request(`/api/shares/${link.id}`, { method: "DELETE" });
          if (created?.id === link.id) { setCreated(null); setCopied(""); }
          setLinks(await request(endpoint));
        })}>Revoke link</button>}
      </li>)}
    </ul>}
  </section>;
}
