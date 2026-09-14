"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspacePresentation, WorkspaceVersion } from "../../../db/workspace-repository.ts";
type Snapshot = { presentation: WorkspacePresentation; expiresAt: string };
export default function SharedView({ id }: { id: string }) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setToken(location.hash.slice(1));
    read(); window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return <>
    <header className="topbar"><a className="wordmark" href="/">◩ frame note</a><span className="local-label">Shared presentation · Local preview</span></header>
    <main id="main" className="shared-page">
      {token === null ? <p role="status">Opening presentation…</p> : <SharedSession key={`${id}:${token}`} id={id} token={token} />}
    </main>
  </>;
}
function SharedSession({ id, token }: { id: string; token: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [retry, setRetry] = useState(0), [screenId, setScreenId] = useState(""), [number, setNumber] = useState("");
  const invalidated = useRef(false);
  const unavailable = useCallback(() => {
    invalidated.current = true; setSnapshot(null); setState("unavailable");
  }, []);
  useEffect(() => {
    if (!/^[\w-]{43}$/.test(token)) { setState("unavailable"); return; }
    let stopped = false, pending = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function check() {
      if (stopped || invalidated.current || pending) return;
      pending = true;
      try {
        const response = await fetch(`/api/shared/${id}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (stopped || invalidated.current) return;
        if (response.status === 404) { unavailable(); stopped = true; return; }
        if (!response.ok) throw new Error();
        const next = await response.json();
        if (!stopped && !invalidated.current) { setSnapshot(next); setState("ready"); }
      } catch { if (!stopped && !invalidated.current) { setSnapshot(null); setState("error"); } }
      finally { pending = false; if (!stopped && !invalidated.current) { clearTimeout(timer); timer = setTimeout(check, 5000); } }
    }
    void check(); window.addEventListener("focus", check);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); window.removeEventListener("focus", check); };
  }, [id, token, retry, unavailable]);
  const screen = snapshot?.presentation.screens.find(s => s.id === screenId) ?? snapshot?.presentation.screens[0];
  const version = screen?.versions.find(v => String(v.number) === number) ?? screen?.versions.at(-1);
  if (state === "unavailable") return <div className="empty"><h1>This link is unavailable.</h1><p>It may have expired, been revoked, or be incomplete. Ask the owner for a new link.</p></div>;
  if (state === "error") return <div className="empty" role="alert"><h1>We could not check this link.</h1><p>Check your connection and try again.</p><button className="secondary" onClick={() => { setState("loading"); setRetry(retry + 1); }}>Retry access</button></div>;
  if (!snapshot) return <p role="status">Opening presentation…</p>;
  return <>
    <div className="review-heading"><div><p className="eyebrow">Read only</p><h1>{snapshot.presentation.title}</h1><p className="note">Access until {new Date(snapshot.expiresAt).toLocaleString()}</p></div></div>
    <nav className="screen-strip" aria-label="Shared screens">{snapshot.presentation.screens.map((s, i) => <button key={s.id} className={screen?.id === s.id ? "active" : ""} aria-pressed={screen?.id === s.id} onClick={() => { setScreenId(s.id); setNumber(""); }}>{i + 1} · {s.title}</button>)}</nav>
    <div className="stage"><div className="stage-toolbar"><span>{screen?.title ?? "No screens yet"}</span>{version && <label className="version-picker">Version<select aria-label="Version" value={String(version.number)} onChange={e => setNumber(e.target.value)}>{screen?.versions.map(v => <option key={v.id} value={v.number}>v{v.number}</option>)}</select></label>}</div>
      {version && screen ? <SharedImage key={version.id} id={id} token={token} version={version} title={screen.title} unavailable={unavailable} /> : <div className="empty"><p>The owner has not uploaded an image here yet.</p></div>}
      <div className="stage-footer"><span>{version ? `${version.width} × ${version.height} px` : "Original proportions"}</span><span>Viewing only · No editing access</span></div>
    </div>
    <p className="note shared-notice">This link covers this presentation only. Access is checked every few seconds. Downloaded images or screenshots cannot be recalled.</p>
  </>;
}
function SharedImage({ id, token, version, title, unavailable }: { id: string; token: string; version: WorkspaceVersion; title: string; unavailable: () => void }) {
  const [url, setUrl] = useState(""), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, objectUrl = "";
    const controller = new AbortController();
    setUrl(""); setError(false);
    fetch(`/api/shared/${id}/assets/${version.assetId}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        if (!active) return;
        if (response.status === 404) { unavailable(); return; }
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
      }).catch(() => { if (active) setError(true); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, token, version.assetId, attempt, unavailable]);
  return <div className="artboard">{error ? <div className="empty" role="alert"><p>The image could not be loaded.</p><button className="secondary" onClick={() => setAttempt(attempt + 1)}>Retry image</button></div> : url ? <img src={url} alt={`${title} v${version.number}`} width={version.width} height={version.height} onError={() => setError(true)} /> : <p role="status">Loading image…</p>}</div>;
}
