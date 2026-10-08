"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceVersion } from "../db/workspace-repository.ts";
import { normalizePin, type Pin } from "../domain/pins.ts";
import { useLanguage } from "./i18n";

type Message = {
  id: string;
  body: string;
  authorId: string;
  isGuest: boolean;
  createdAt: string;
};
type Thread = {
  id: string;
  versionId: string;
  x: number;
  y: number;
  resolved: boolean;
  messages: Message[];
};
type Props = {
  version: WorkspaceVersion;
  title: string;
  busy: boolean;
  request: (path: string, options?: RequestInit) => Promise<any>;
  execute: (work: () => Promise<void>) => Promise<void>;
};
const payload = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

export default function ReviewCanvas({
  version,
  title,
  busy,
  request,
  execute,
}: Props) {
  const { t } = useLanguage();
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const [threads, setThreads] = useState<Thread[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(""),
    [placing, setPlacing] = useState(false),
    [pin, setPin] = useState<Pin | null>(null);
  const [text, setText] = useState(""),
    [reply, setReply] = useState("");
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const thread = threads.find((t) => t.id === selected);
  const url = `/api/comments?versionId=${version.id}`;
  useEffect(() => {
    let active = true;
    request(url)
      .then((result) => {
        if (active) {
          setThreads(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, request]);
  async function refresh() {
    const result = await request(url);
    setThreads(result);
    setLoading(false);
    return result as Thread[];
  }
  async function action(work: () => Promise<void>) {
    await execute(async () => {
      setError("");
      try {
        await work();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Please try again.");
        throw e;
      }
    });
  }
  function choosePin(next: Pin) {
    setPin(next);
    setSelected("");
    requestAnimationFrame(() => commentInput.current?.focus());
  }
  function selectThread(id: string) {
    setSelected(id);
    setReply("");
    setPlacing(false);
    setPin(null);
    setText("");
  }
  return (
    <div className="review-canvas">
      <div className="artboard">
        {imageState === "loading" && <p role="status">{t("loadingImage", { side: "" })}</p>}
        {imageState === "error" ? (
          <div className="empty" role="alert">
            <p>{t("imageFailed")}</p>
            <button
              className="secondary"
              onClick={() => {
                setImageState("loading");
                setAttempt(attempt + 1);
              }}
            >
              {t("retryImage")}
            </button>
          </div>
        ) : (
          <div
            className={`pin-image ${placing ? "placing" : ""}`}
            style={{
              display: imageState === "loading" ? "none" : undefined,
              width: `min(100%, ${version.width}px, ${(58 * version.width) / version.height}vh)`,
            }}
          >
            <img
              key={attempt}
              src={`/api/assets/${version.assetId}?attempt=${attempt}`}
              alt={title}
              width={version.width}
              height={version.height}
              onLoad={() => setImageState("ready")}
              onError={() => setImageState("error")}
              onClick={(e) => {
                if (!placing || busy) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const next = normalizePin({ x: e.clientX, y: e.clientY }, rect);
                if (next) choosePin(next);
              }}
            />
            {threads.map((t, i) => (
              <button
                key={t.id}
                className={`pin-marker ${t.resolved ? "resolved" : ""} ${selected === t.id ? "selected" : ""}`}
                aria-label={`Pin ${i + 1}`}
                aria-pressed={selected === t.id}
                disabled={busy}
                style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
                onClick={() => selectThread(t.id)}
              >
                {i + 1}
              </button>
            ))}
            {pin && (
              <span
                className="pin-marker draft"
                aria-hidden="true"
                style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
              >
                +
              </span>
            )}
          </div>
        )}
      </div>
      <section
        className="discussion"
        aria-label={`${t("comments")} / v${version.number}`}
      >
        <div className="discussion-heading">
          <div>
            <h3>
              {t("comments")} <span className="note">/ v{version.number}</span>
            </h3>
            <p className="note">{t("feedbackAttached")}</p>
          </div>
          <button
            className="secondary"
            aria-label="Add pin"
            disabled={busy || loading || !!error || imageState !== "ready"}
            aria-pressed={placing}
            onClick={() => {
              setPlacing(!placing);
              setPin(null);
              setText("");
              setSelected("");
            }}
          >
            {t("addPin")}
          </button>
        </div>
        {loading && <p role="status">{t("loadingComments")}</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await refresh();
                })
              }
            >
              {t("reloadComments")}
            </button>
          </div>
        )}
        {placing && (
          <div className="pin-composer">
            <p>
              {t("clickImage")}
            </p>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => choosePin({ x: 0.5, y: 0.5 })}
            >
              {t("placeCenter")}
            </button>
            {pin && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    const created = await request(
                      "/api/comments",
                      payload("POST", {
                        versionId: version.id,
                        ...pin,
                        body: text,
                      }),
                    );
                    setText("");
                    setPin(null);
                    setPlacing(false);
                    setSelected(created.id);
                    await refresh();
                  });
                }}
              >
                <div className="pin-coordinates">
                  <label>
                    {t("horizontal")}
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      required
                      disabled={busy}
                      value={Math.round(pin.x * 10000) / 100}
                      onChange={(e) =>
                        setPin({ ...pin, x: Number(e.target.value) / 100 })
                      }
                    />
                  </label>
                  <label>
                    {t("vertical")}
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      required
                      disabled={busy}
                      value={Math.round(pin.y * 10000) / 100}
                      onChange={(e) =>
                        setPin({ ...pin, y: Number(e.target.value) / 100 })
                      }
                    />
                  </label>
                </div>
                <label htmlFor="pin-comment">{t("comment")}</label>
                <textarea
                  ref={commentInput}
                  id="pin-comment"
                  required
                  maxLength={2000}
                  value={text}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="comment-actions">
                  <button className="primary" disabled={busy || !text.trim()}>
                    {t("postComment")}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() => {
                      setPlacing(false);
                      setPin(null);
                      setText("");
                    }}
                  >
                    {t("cancel")}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        {!loading && !error && threads.length === 0 && (
          <p className="note">{t("noComments")}</p>
        )}
        <div className="discussion-columns">
          <nav aria-label={t("comments")}>
            {threads.map((threadItem, i) => (
              <button
                key={threadItem.id}
                className={`thread-link ${selected === threadItem.id ? "selected" : ""}`}
                disabled={busy}
                aria-pressed={selected === threadItem.id}
                onClick={() => selectThread(threadItem.id)}
              >
                <span>
                  #{i + 1} · {threadItem.resolved ? t("resolved") : t("open")}
                </span>
                <span>{threadItem.messages[0]?.body.length > 24 ? `${threadItem.messages[0].body.slice(0, 24)}…` : threadItem.messages[0]?.body}</span>
                <small>
                  {threadItem.messages.length}{" "}
                  {threadItem.messages.length === 1 ? t("message") : t("messages")}
                </small>
              </button>
            ))}
          </nav>
          {thread && (
            <div className="thread-detail">
              <div className="discussion-heading">
                <h4>{t("discussion", { n: threads.indexOf(thread) + 1 })}</h4>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await request(
                        `/api/comments/${thread.id}`,
                        payload("PATCH", {
                          versionId: version.id,
                          resolved: !thread.resolved,
                        }),
                      );
                      await refresh();
                    })
                  }
                >
                  {thread.resolved ? t("reopen") : t("resolve")}
                </button>
              </div>
              <ol className="messages">
                {thread.messages.map((m, i) => (
                  <li key={m.id}>
                    <div className="note">
                        {m.isGuest ? t("guest") : i === 0 ? t("original") : t("reply")}{" "}
                      <time dateTime={m.createdAt}>
                        {new Date(m.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <p>{m.body}</p>
                  </li>
                ))}
              </ol>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    await request(
                      `/api/comments/${thread.id}`,
                      payload("POST", { versionId: version.id, body: reply }),
                    );
                    setReply("");
                    await refresh();
                  });
                }}
              >
                <label htmlFor="comment-reply">{t("reply")}</label>
                <textarea
                  id="comment-reply"
                  required
                  maxLength={2000}
                  disabled={busy}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <button className="secondary" disabled={busy || !reply.trim()}>
                  {t("postReply")}
                </button>
              </form>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
