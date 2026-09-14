"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { WorkspaceSnapshot } from "../db/workspace-repository.ts";
import ReviewStage from "./review-stage.tsx";
import ShareManager from "./share-manager.tsx";
class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error ?? "Please try again.", response.status);
  return data;
}
const post = (value: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
export default function Workspace() {
  const activeOperations = useRef(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const revisionInput = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<WorkspaceSnapshot | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [presentationId, setPresentationId] = useState(""),
    [screenId, setScreenId] = useState(""),
    [versionNumber, setVersionNumber] = useState("");
  const [presentationTitle, setPresentationTitle] = useState(""),
    [screenTitle, setScreenTitle] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [revision, setRevision] = useState<File | null>(null);
  const presentation =
    data?.presentations.find((p) => p.id === presentationId) ??
    data?.presentations[0];
  const screen =
    presentation?.screens.find((s) => s.id === screenId) ??
    presentation?.screens[0];
  const version =
    screen?.versions.find((v) => String(v.number) === versionNumber) ??
    screen?.versions.at(-1);
  function clearRevision() {
    setRevision(null);
    setVersionNumber("");
    if (revisionInput.current) revisionInput.current.value = "";
  }
  function clearDrafts() {
    setScreenTitle("");
    setFile(null);
    clearRevision();
    if (imageInput.current) imageInput.current.value = "";
  }
  async function refresh() {
    const result = await api("/api/workspace");
    setData(result);
    return result as WorkspaceSnapshot;
  }
  useEffect(() => {
    fetch("/api/workspace")
      .then(async (r) => {
        if (r.status === 401) return;
        if (!r.ok) throw new Error((await r.json()).error);
        setData(await r.json());
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function run(work: () => Promise<void>, localErrors = false) {
    activeOperations.current += 1;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
        setPresentationId("");
        setScreenId("");
        setPresentationTitle("");
        clearDrafts();
      }
      if (!localErrors || (e instanceof ApiError && e.status === 401))
        setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      activeOperations.current -= 1;
      setBusy(activeOperations.current > 0);
    }
  }
  async function start() {
    await run(async () => {
      await api("/api/demo", { method: "POST" });
      clearDrafts();
      setPresentationTitle("");
      await refresh();
    });
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const result = await api(
        "/api/presentations",
        post({ title: presentationTitle }),
      );
      await refresh();
      setPresentationId(result.id);
      setScreenId("");
      setVersionNumber("");
      setPresentationTitle("");
      clearDrafts();
    });
  }
  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file || !presentation) return;
    await run(async () => {
      // Creation and upload are separate persisted operations. Keep the created
      // screen selected on an upload failure so a new-version retry can finish it.
      const created = await api(
        "/api/screens",
        post({ title: screenTitle, presentationId: presentation.id }),
      );
      setScreenId(created.id);
      await refresh();
      await api(`/api/upload?screenId=${created.id}`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      await refresh();
      setVersionNumber("");
      setScreenTitle("");
      setFile(null);
      if (imageInput.current) imageInput.current.value = "";
    });
  }
  async function newVersion(e: FormEvent) {
    e.preventDefault();
    if (!revision || !screen) return;
    await run(async () => {
      const result = await api(`/api/upload?screenId=${screen.id}`, {
        method: "POST",
        headers: { "content-type": revision.type },
        body: revision,
      });
      await refresh();
      setVersionNumber(String(result.number));
      setRevision(null);
      if (revisionInput.current) revisionInput.current.value = "";
    });
  }
  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Frame Note home">
          <span className="mark" aria-hidden="true">
            ◩
          </span>{" "}
          frame note<span className="edition">/ review studio</span>
        </a>
        <div className="top-actions">
          <span className="local-label">Local preview</span>
          {data && (
            <button
              className="quiet"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/api/demo", { method: "DELETE" });
                  setData(null);
                  setPresentationId("");
                  setScreenId("");
                  clearDrafts();
                  setPresentationTitle("");
                })
              }
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main id="main">
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="quiet" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading" role="status">
            Opening your worktable…
          </div>
        ) : !data ? (
          <section className="welcome">
            <div className="intro">
              <p className="eyebrow">A little space for a closer look</p>
              <h1>
                Keep the work
                <br />
                in the picture.
              </h1>
              <p className="lead">
                Bring your screens together. Keep every revision in view. Make
                room for a more considered review.
              </p>
              <button className="primary" disabled={busy} onClick={start}>
                {busy ? "Preparing your space…" : "Start a private demo"}
                <span aria-hidden="true"> ↗</span>
              </button>
              <p className="note">
                No account needed · Local files · 24-hour session
              </p>
              <p className="scope-note">
                Early preview: image versions, comparison and pinned discussions.
                <br />
                View-only sharing is available. Guest comments are still being built.
              </p>
            </div>
            <div className="paper-study" aria-hidden="true">
              <div className="study-caption">FRAME NOTE / WORK IN PROGRESS</div>
              <div className="study-sheet back"></div>
              <div className="study-sheet front">
                <span>01 — A place for the work</span>
                <div className="study-shape"></div>
                <p>
                  A different
                  <br />
                  point of view.
                </p>
                <span className="study-foot">Collect. Consider. Refine.</span>
              </div>
              <div className="study-index">
                Your ideas, with room to breathe.
              </div>
            </div>
          </section>
        ) : (
          <div className="workspace">
            <aside className="sidebar">
              <div className="sidebar-heading">
                <p className="eyebrow">Your private worktable</p>
                <h1>Presentations</h1>
                <p className="note">
                  Saved locally. Available during this demo.
                </p>
              </div>
              <nav aria-label="Presentations">
                {data.presentations.map((p, index) => (
                  <button
                    key={p.id}
                    disabled={busy}
                    aria-pressed={presentation?.id === p.id}
                    className={`presentation-link ${presentation?.id === p.id ? "selected" : ""}`}
                    onClick={() => {
                      setPresentationId(p.id);
                      setScreenId("");
                      setVersionNumber("");
                      clearDrafts();
                    }}
                  >
                    <span className="index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      {p.title}
                      <small>
                        {p.screens.length}{" "}
                        {p.screens.length === 1 ? "screen" : "screens"}
                      </small>
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </nav>
              <form onSubmit={create} className="create-form">
                <label htmlFor="presentation-title">Presentation title</label>
                <input
                  id="presentation-title"
                  disabled={busy}
                  value={presentationTitle}
                  onChange={(e) => setPresentationTitle(e.target.value)}
                  maxLength={160}
                  required
                  placeholder="e.g. Autumn collection"
                />
                <button
                  disabled={busy || !presentationTitle.trim()}
                  className="secondary"
                >
                  Create presentation
                </button>
              </form>
              <div className="sidebar-footer">
                <span className="status-dot" />
                Private demo workspace
                <br />
                <small>Only this browser session has access.</small>
              </div>
            </aside>
            <section
              className="review-area"
              aria-label="Presentation workspace"
            >
              <div className="review-heading">
                <div>
                  <p className="eyebrow">
                    Design review /{" "}
                    {presentation ? "In progress" : "Getting started"}
                  </p>
                  <h2>{presentation?.title ?? "Start with a presentation."}</h2>
                </div>
                {presentation && (
                  <span className="count">
                    {presentation.screens.length} screens
                  </span>
                )}
              </div>
              {!presentation ? (
                <div className="empty">
                  <span className="empty-symbol" aria-hidden="true">
                    ⊞
                  </span>
                  <h3>A clear space for your next idea.</h3>
                  <p>
                    Create a presentation on the left, then add your first
                    design image.
                  </p>
                </div>
              ) : (
                <>
                  <div className="screen-strip" aria-label="Screens">
                    {presentation.screens.map((s, i) => (
                      <button
                        disabled={busy}
                        aria-pressed={screen?.id === s.id}
                        className={screen?.id === s.id ? "active" : ""}
                        key={s.id}
                        onClick={() => {
                          setScreenId(s.id);
                          setVersionNumber("");
                          clearRevision();
                        }}
                      >
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        {s.title}
                      </button>
                    ))}
                  </div>
                  <div className="stage">
                    <div className="stage-toolbar">
                      <span>{screen?.title ?? "No screens yet"}</span>
                      {version && (
                        <label className="version-picker">
                          Version
                          <select
                            aria-label="Version"
                            disabled={busy}
                            value={String(version.number)}
                            onChange={(e) => setVersionNumber(e.target.value)}
                          >
                            {screen?.versions.map((v) => (
                              <option key={v.id} value={String(v.number)}>
                                v{v.number}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <div>
                      {version && screen ? (
                        <ReviewStage
                          key={`${screen.id}:${version.id}`}
                          screen={screen}
                          version={version}
                          title={screen.title}
                          busy={busy}
                          request={api}
                          execute={(work) => run(work, true)}
                        />
                      ) : (
                        <div className="empty">
                          <span className="empty-symbol" aria-hidden="true">
                            ＋
                          </span>
                          <h3>
                            {screen
                              ? "This screen needs an image."
                              : "Let the work speak."}
                          </h3>
                          <p>
                            {screen
                              ? "Use “Upload new version” below to finish this screen."
                              : "Upload a PNG, JPEG or WebP image to begin."}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="stage-footer">
                      <span>
                        {version
                          ? `Review v${version.number} · ${version.width} × ${version.height} px`
                          : "Images stay in their original proportions."}
                      </span>
                      <span>Private · Local storage</span>
                    </div>
                  </div>
                  <div className="upload-forms">
                    <form onSubmit={upload}>
                      <h3>Add a screen</h3>
                      <p className="note">PNG, JPEG or WebP · up to 10 MiB</p>
                      <label htmlFor="screen-title">Screen title</label>
                      <input
                        id="screen-title"
                        disabled={busy}
                        required
                        maxLength={160}
                        value={screenTitle}
                        onChange={(e) => setScreenTitle(e.target.value)}
                        placeholder="e.g. Landing page"
                      />
                      <label htmlFor="image-file">Image file</label>
                      <input
                        id="image-file"
                        disabled={busy}
                        ref={imageInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                      <button
                        className="primary"
                        disabled={busy || !file || !screenTitle.trim()}
                      >
                        Upload screen
                      </button>
                    </form>
                    {screen && (
                      <form onSubmit={newVersion}>
                        <h3>Keep the next revision</h3>
                        <p className="note">
                          Add to “{screen.title}”. Previous versions stay
                          unchanged.
                        </p>
                        <label htmlFor="revision-file">New version image</label>
                        <input
                          id="revision-file"
                          disabled={busy}
                          ref={revisionInput}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(e) =>
                            setRevision(e.target.files?.[0] ?? null)
                          }
                        />
                        <button
                          className="secondary"
                          disabled={busy || !revision}
                        >
                          Upload new version
                        </button>
                      </form>
                    )}
                  </div>
                  <ShareManager key={presentation.id} presentationId={presentation.id}
                    busy={busy} request={api} execute={work => run(work, true)} />
                </>
              )}
            </section>
          </div>
        )}
        {busy && (
          <div className="working" role="status">
            Saving your work…
          </div>
        )}
      </main>
    </>
  );
}
