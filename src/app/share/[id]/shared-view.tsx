"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspacePresentation, WorkspaceVersion } from "../../../db/workspace-repository.ts";
import { normalizePin } from "../../../domain/pins.ts";
type Message = { id: string; body: string; authorId: string | null; isGuest: boolean; createdAt: string };
type Thread = { id: string; versionId: string; x: number; y: number; resolved: boolean; messages: Message[] };
type Snapshot = { presentation: WorkspacePresentation; expiresAt: string; allowComments: boolean };
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
  const [placingGuestPin, setPlacingGuestPin] = useState(false), [guestPin, setGuestPin] = useState<{x:number;y:number} | null>(null);
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
      {version && screen ? <SharedImage key={version.id} id={id} token={token} version={version} title={screen.title} unavailable={unavailable} placing={placingGuestPin} onPin={setGuestPin} /> : <div className="empty"><p>The owner has not uploaded an image here yet.</p></div>}
      <div className="stage-footer"><span>{version ? `${version.width} × ${version.height} px` : "Original proportions"}</span><span>Viewing only · No editing access</span></div>
    </div>
    {version && snapshot.allowComments && <GuestComments id={id} token={token} version={version} unavailable={unavailable} placing={placingGuestPin} setPlacing={setPlacingGuestPin} pin={guestPin} setPin={setGuestPin} />}
    <p className="note shared-notice">This link covers this presentation only. Access is checked every few seconds. Downloaded images or screenshots cannot be recalled.</p>
  </>;
}

function GuestComments({ id, token, version, unavailable, placing, setPlacing, pin, setPin }: { id: string; token: string; version: WorkspaceVersion; unavailable: () => void; placing: boolean; setPlacing: (value: boolean) => void; pin: {x:number;y:number} | null; setPin: (value: {x:number;y:number} | null) => void }) {
  const [threads, setThreads] = useState<Thread[]>([]), [selected, setSelected] = useState(""), [text, setText] = useState(""), [reply, setReply] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const generation = useRef(0), request = useRef<AbortController | null>(null);
  const current = threads.find(t => t.id === selected);
  const load = useCallback(async (expected = generation.current) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const response = await fetch(`/api/shared/${id}/comments?versionId=${version.id}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
    if (response.status === 404) { unavailable(); throw new Error("unavailable"); }
    if (!response.ok) throw new Error("Comments could not be loaded.");
    const next = await response.json() as Thread[];
    if (expected !== generation.current || controller.signal.aborted) return;
    setThreads(next); setLoading(false);
  }, [id, token, version.id, unavailable]);
  useEffect(() => {
    const expected = ++generation.current;
    request.current?.abort();
    setThreads([]); setLoading(true); setError(""); setSelected(""); setPin(null); setPlacing(false);
    void load(expected).catch(e => { if (expected === generation.current && e instanceof Error && e.message !== "unavailable" && e.name !== "AbortError") { setError(e.message); setLoading(false); } });
    return () => { request.current?.abort(); };
  }, [load, setPin, setPlacing]);
  async function submit(path: string, body: unknown) {
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    const response = await fetch(path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
    if (response.status === 404) { unavailable(); throw new Error("unavailable"); }
    if (!response.ok) throw new Error("Comment could not be saved.");
  }
  async function reload() { setLoading(true); setError(""); try { await load(generation.current); } catch (e) { if (e instanceof Error && e.message !== "unavailable" && e.name !== "AbortError") { setError(e.message); setLoading(false); } } }
  return <section className="discussion shared-discussion" aria-label={`Guest comments on version ${version.number}`}><div className="discussion-heading"><div><h3>Comments <span className="note">/ v{version.number}</span></h3><p className="note">Guest comments are shared with the owner.</p></div><button className="secondary" aria-pressed={placing} onClick={() => { setPlacing(!placing); setPin(null); }}>Add pin</button></div>
    {loading && <p role="status">Loading comments…</p>}{error && <div role="alert"><p>{error}</p><button className="secondary" onClick={() => void reload()}>Reload comments</button></div>}
    {placing && <div className="pin-composer"><p>Click the image to choose a location, or place a pin at the center.</p><button className="quiet" onClick={() => setPin({x:.5,y:.5})}>Place at center</button>{pin && <form onSubmit={async e => { e.preventDefault(); try { await submit(`/api/shared/${id}/comments`, { versionId: version.id, ...pin, body: text }); setText(""); setPin(null); setPlacing(false); await load(generation.current); } catch (e) { if (e instanceof Error && e.message !== "unavailable" && e.name !== "AbortError") setError(e.message); } }}><label>Comment<textarea required maxLength={2000} value={text} onChange={e => setText(e.target.value)} /></label><button className="primary" disabled={!text.trim()}>Post comment</button></form>}</div>}
    {!loading && !error && threads.length === 0 && <p className="note">No comments on this version yet.</p>}<nav aria-label="Guest comment threads">{threads.map((t, i) => <button key={t.id} className={`thread-link ${selected === t.id ? "selected" : ""}`} onClick={() => setSelected(t.id)}><span>#{i + 1} · {t.resolved ? "Resolved" : "Open"}</span><span>{t.messages[0]?.body}</span><small>{t.messages.length} {t.messages.length === 1 ? "message" : "messages"}</small></button>)}</nav>
    {current && <div className="thread-detail"><h4>Discussion #{threads.indexOf(current) + 1}</h4><ol className="messages">{current.messages.map(m => <li key={m.id}><div className="note">{m.isGuest ? "Guest" : "Owner"}</div><p>{m.body}</p></li>)}</ol><form onSubmit={async e => { e.preventDefault(); try { await submit(`/api/shared/${id}/comments/${current.id}`, { versionId: version.id, body: reply }); setReply(""); await load(generation.current); } catch (e) { if (e instanceof Error && e.message !== "unavailable" && e.name !== "AbortError") setError(e.message); } }}><label>Reply<textarea required maxLength={2000} value={reply} onChange={e => setReply(e.target.value)} /></label><button className="secondary" disabled={!reply.trim()}>Post reply</button></form></div>}
  </section>;
}
function SharedImage({ id, token, version, title, unavailable, placing, onPin }: { id: string; token: string; version: WorkspaceVersion; title: string; unavailable: () => void; placing: boolean; onPin: (pin: {x:number;y:number}) => void }) {
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
  return <div className="artboard">{error ? <div className="empty" role="alert"><p>The image could not be loaded.</p><button className="secondary" onClick={() => setAttempt(attempt + 1)}>Retry image</button></div> : url ? <div className={`pin-image ${placing ? "placing" : ""}`}><img src={url} alt={`${title} v${version.number}`} width={version.width} height={version.height} onError={() => setError(true)} onClick={e => { if (!placing) return; const pin = normalizePin({ x: e.clientX, y: e.clientY }, e.currentTarget.getBoundingClientRect()); if (pin) onPin(pin); }} /></div> : <p role="status">Loading image…</p>}</div>;
}
