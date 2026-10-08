"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { WorkspaceSnapshot } from "../db/workspace-repository.ts";
import ReviewStage from "./review-stage.tsx";
import ShareManager from "./share-manager.tsx";
import { LanguageToggle, useLanguage } from "./i18n";
import { Icon } from "./icons";
type WorkspaceView = "overview" | "projects" | "feedback" | "share" | "settings";
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
  const { t } = useLanguage();
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
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");
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
  function navigateTo(view: WorkspaceView, selector?: string) {
    setActiveView(view);
    if (selector) {
      window.requestAnimationFrame(() => {
        document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }
  function FilePicker({ id, label, file, inputRef, onChange }: { id: string; label: string; file: File | null; inputRef: React.RefObject<HTMLInputElement | null>; onChange: (file: File | null) => void }) {
    return (
      <div className="file-picker">
        <input
          id={id}
          className="file-input-hidden"
          aria-label={label}
          disabled={busy}
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        />
        <label className="file-picker-control" htmlFor={id}>
          <span className="file-picker-button">{t("chooseFile")}</span>
          <span className="file-picker-name">{file?.name ?? t("noFileSelected")}</span>
        </label>
      </div>
    );
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
      <a className="skip" href="#main">{t("skip")}</a>
      <header className="topbar">
        <a className="wordmark" href="/" aria-label={t("home")}>
          <span className="mark" aria-hidden="true"><Icon name="brand" size={22} strokeWidth={2} /></span>
          frame note<span className="edition">{t("edition")}</span>
        </a>
        <div className="top-actions">
          <span className="local-label">{t("local")}</span>
          <LanguageToggle />
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
              {t("signOut")}
            </button>
          )}
        </div>
      </header>
      <main id="main">
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="quiet" onClick={() => setError("")}>
            {t("dismiss")}
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading" role="status">
            {t("opening")}
          </div>
        ) : !data ? (
          <section className="welcome app-home">
            <aside className="app-rail" aria-label="Workspace tools">
              <span className="rail-logo" aria-hidden="true"><Icon name="brand" size={19} /></span><span className="rail-spacer" aria-hidden="true" />
              <button className={`rail-tool ${activeView === "overview" ? "active" : ""}`} aria-label={t("reviewSpace")} aria-pressed={activeView === "overview"} type="button" onClick={() => navigateTo("overview", ".welcome-main")}><Icon name="home" /></button>
              <button className={`rail-tool ${activeView === "projects" ? "active" : ""}`} aria-label={t("presentations")} aria-pressed={activeView === "projects"} type="button" onClick={() => navigateTo("projects", ".welcome-list")}><Icon name="projects" /></button>
              <button className={`rail-tool ${activeView === "feedback" ? "active" : ""}`} aria-label={t("comments")} aria-pressed={activeView === "feedback"} type="button" onClick={() => navigateTo("feedback", ".welcome-main")}><Icon name="feedback" /></button>
              <span className="rail-spacer" aria-hidden="true" /><span className="rail-avatar" aria-hidden="true">FN</span>
            </aside>
            <aside className="welcome-list">
              <div className="workspace-switcher"><span className="workspace-avatar">FN</span><span><strong>Frame Note</strong><small>{t("reviewSpace")}</small></span><Icon name="arrow-up-right" size={15} /></div>
              <div className="welcome-search"><Icon name="search" size={16} /> <span>{t("recent")}</span><kbd>⌘ K</kbd></div>
              <div className="welcome-nav-label">{t("essentials")}</div>
              <button className={`welcome-nav-item ${activeView === "overview" ? "active" : ""}`} type="button" aria-pressed={activeView === "overview"} onClick={() => navigateTo("overview", ".welcome-main")}><Icon name="home" size={16} /><span>{t("overview")}</span></button>
              <button className={`welcome-nav-item ${activeView === "projects" ? "active" : ""}`} type="button" aria-pressed={activeView === "projects"} onClick={() => navigateTo("projects", ".welcome-list")}><Icon name="projects" size={16} /><span>{t("presentations")}</span></button>
              <button className={`welcome-nav-item ${activeView === "feedback" ? "active" : ""}`} type="button" aria-pressed={activeView === "feedback"} onClick={() => navigateTo("feedback", ".welcome-main")}><Icon name="feedback" size={16} /><span>{t("comments")}</span></button>
              <div className="welcome-list-heading"><span>{t("presentations")}</span><span>0</span></div>
              <div className="welcome-empty"><span className="welcome-empty-icon"><Icon name="plus" /></span><strong>{t("noProjects")}</strong><p>{t("startHereBody")}</p></div>
            </aside>
            <div className="welcome-main">
              <div className="welcome-main-head"><div><p className="breadcrumb">{t("overview")}</p><h1>{t("dashboard")}</h1></div><div className="head-actions"><LanguageToggle /><span className="status-pill">{t("privateWorkspace")}</span></div></div>
              <div className="welcome-card">
                <div className="welcome-card-icon"><Icon name="layers" size={24} /></div><p className="eyebrow">{t("startHere")}</p><h2>{t("heroTitle")}</h2><p className="lead">{t("heroLead")}</p><button aria-label="Start a private demo" className="primary" disabled={busy} onClick={start}>{busy ? t("preparing") : t("startDemo")} <Icon name="arrow-up-right" size={17} /></button>
              </div>
              <div className="welcome-compose"><Icon name="upload" size={17} /><span>{t("preview")}</span><span className="compose-send"><Icon name="arrow-up-right" size={16} /></span></div>
            </div>
            <aside className="welcome-side">
              <div className="info-card"><div className="info-card-head"><strong>{t("howItWorks")}</strong><Icon name="arrow-up-right" size={16} /></div><ol><li>{t("stepUpload")}</li><li>{t("stepCompare")}</li><li>{t("stepDiscuss")}</li></ol></div>
              <div className="info-card info-card-soft"><div className="info-card-head"><strong>{t("sharingPreview")}</strong><Icon name="share" size={16} /></div><p>{t("shareHelp")}</p></div>
            </aside>
          </section>
        ) : (
          <div className="workspace">
            <aside className="app-rail" aria-label="Workspace tools">
              <span className="rail-logo" aria-hidden="true"><Icon name="brand" size={19} /></span>
              <span className="rail-spacer" aria-hidden="true" />
              <button className={`rail-tool ${activeView === "overview" ? "active" : ""}`} aria-label="Review workspace" aria-pressed={activeView === "overview"} type="button" onClick={() => navigateTo("overview", ".review-area")}><Icon name="home" /></button>
              <button className={`rail-tool ${activeView === "projects" ? "active" : ""}`} aria-label="Presentations" aria-pressed={activeView === "projects"} type="button" onClick={() => navigateTo("projects", ".sidebar")}><Icon name="projects" /></button>
              <button className={`rail-tool ${activeView === "feedback" ? "active" : ""}`} aria-label="Comments" aria-pressed={activeView === "feedback"} type="button" onClick={() => navigateTo("feedback", "#feedback-section")}><Icon name="feedback" /></button>
              <button className={`rail-tool ${activeView === "share" ? "active" : ""}`} aria-label="Share links" aria-pressed={activeView === "share"} type="button" onClick={() => navigateTo("share", "#share-section")}><Icon name="share" /></button>
              <span className="rail-spacer" aria-hidden="true" />
              <button className={`rail-tool ${activeView === "settings" ? "active" : ""}`} aria-label="Settings" aria-pressed={activeView === "settings"} type="button" onClick={() => navigateTo("settings", "#settings-section")}><Icon name="settings" /></button>
              <span className="rail-avatar" aria-hidden="true">FN</span>
            </aside>
            <aside className="sidebar">
              <div className="workspace-switcher"><span className="workspace-avatar">FN</span><span><strong>Frame Note</strong><small>{t("reviewSpace")}</small></span><Icon name="arrow-up-right" size={15} /></div>
              <div className="sidebar-search"><Icon name="search" size={16} /><span>{t("recent")}</span><kbd>⌘ K</kbd></div>
              <div className="sidebar-nav-label">{t("essentials")}</div>
              <button className={`sidebar-nav-item ${activeView === "overview" ? "active" : ""}`} type="button" aria-pressed={activeView === "overview"} onClick={() => navigateTo("overview", ".review-area")}><Icon name="home" size={16} /><span>{t("overview")}</span></button>
              <button className={`sidebar-nav-item ${activeView === "projects" ? "active" : ""}`} type="button" aria-pressed={activeView === "projects"} onClick={() => navigateTo("projects", ".sidebar-heading")}><Icon name="projects" size={16} /><span>{t("presentations")}</span></button>
              <button className={`sidebar-nav-item ${activeView === "feedback" ? "active" : ""}`} type="button" aria-pressed={activeView === "feedback"} onClick={() => navigateTo("feedback", "#feedback-section")}><Icon name="feedback" size={16} /><span>{t("comments")}</span></button>
              <div className="sidebar-heading">
                <p className="eyebrow">{t("worktable")}</p>
                <h1>{t("presentations")}</h1>
                <p className="note">
                  {t("saved")}
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
                      setActiveView("projects");
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
                        {p.screens.length === 1 ? t("screen") : t("screens")}
                      </small>
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </nav>
              <form onSubmit={create} className="create-form">
                <label htmlFor="presentation-title">{t("presentationTitle")}</label>
                <input
                  id="presentation-title"
                  aria-label="Presentation title"
                  disabled={busy}
                  value={presentationTitle}
                  onChange={(e) => setPresentationTitle(e.target.value)}
                  maxLength={160}
                  required
                  placeholder={t("presentationPlaceholder")}
                />
                <button
                  aria-label="Create presentation"
                  disabled={busy || !presentationTitle.trim()}
                  className="secondary"
                >
                  <span aria-hidden="true">{t("createPresentation")}</span>
                </button>
              </form>
              <div className="sidebar-footer">
                <span className="status-dot" />
                {t("privateWorkspace")}
                <br />
                <small>{t("onlyBrowser")}</small>
              </div>
            </aside>
            <section
              className="review-area"
              aria-label={t("presentations")}
            >
              {activeView === "settings" && (
                <section className="settings-panel" id="settings-section" aria-labelledby="settings-title">
                  <div><p className="eyebrow">{t("settings")}</p><h3 id="settings-title">{t("workspaceSettings")}</h3><p className="note">{t("settingsHelp")}</p></div>
                  <div className="settings-row"><span><strong>{t("language")}</strong><small>{t("languageHelp")}</small></span><LanguageToggle /></div>
                </section>
              )}
              <div className="review-heading">
                <div>
                  <p className="eyebrow">
                    {t("designReview")} / {presentation ? t("inProgress") : t("gettingStarted")}
                  </p>
                  <h2>{presentation?.title ?? t("startPresentation")}</h2>
                </div>
                {presentation && (
                  <span className="count">
                    {presentation.screens.length} {t("screens")}
                  </span>
                )}
              </div>
              {!presentation ? (
                <div className="empty">
                  <span className="empty-symbol" aria-hidden="true">
                    ⊞
                  </span>
                  <h3>{t("clearSpace")}</h3>
                  <p>{t("createThenAdd")}</p>
                </div>
              ) : (
                <>
                  <div className="screen-strip" aria-label={t("screens")}>
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
                  <div className="stage" id="feedback-section">
                    <div className="stage-toolbar">
                      <span>{screen?.title ?? t("noScreens")}</span>
                      {version && (
                        <label className="version-picker">
                          {t("version")}
                          <select
                            aria-label={t("version")}
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
                              ? t("needsImage") : t("letWork")}
                          </h3>
                          <p>
                            {screen
                              ? t("finishScreen") : t("uploadBegin")}
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="stage-footer">
                      <span>
                        {version
                          ? t("reviewSize", { n: version.number, w: version.width, h: version.height }) : t("originalProportions")}
                      </span>
                      <span>{t("privateLocal")}</span>
                    </div>
                  </div>
                  <div className="upload-forms">
                    <form onSubmit={upload}>
                      <h3>{t("addScreen")}</h3>
                      <p className="note">{t("imageTypes")}</p>
                      <label htmlFor="screen-title">{t("screenTitle")}</label>
                      <input
                        id="screen-title"
                        aria-label="Screen title"
                        disabled={busy}
                        required
                        maxLength={160}
                        value={screenTitle}
                        onChange={(e) => setScreenTitle(e.target.value)}
                        placeholder={t("screenPlaceholder")}
                      />
                      <label htmlFor="image-file">{t("imageFile")}</label>
                      <FilePicker id="image-file" label="Image file" file={file} inputRef={imageInput} onChange={setFile} />
                      <button
                        aria-label="Upload screen"
                        className="primary"
                        disabled={busy || !file || !screenTitle.trim()}
                      >
                        {t("uploadScreen")}
                      </button>
                    </form>
                    {screen && (
                      <form onSubmit={newVersion}>
                        <h3>{t("nextRevision")}</h3>
                        <p className="note">
                          {t("addTo", { title: screen.title })}
                        </p>
                        <label htmlFor="revision-file">{t("newVersionImage")}</label>
                        <FilePicker id="revision-file" label="New version image" file={revision} inputRef={revisionInput} onChange={setRevision} />
                        <button
                          aria-label="Upload new version"
                          className="secondary"
                          disabled={busy || !revision}
                        >
                          {t("uploadVersion")}
                        </button>
                      </form>
                    )}
                  </div>
                  <div id="share-section"><ShareManager key={presentation.id} presentationId={presentation.id}
                    busy={busy} request={api} execute={work => run(work, true)} />
                  </div>
                </>
              )}
            </section>
          </div>
        )}
        {busy && (
          <div className="working" role="status">
            {t("saving")}
          </div>
        )}
      </main>
    </>
  );
}
