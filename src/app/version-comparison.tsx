"use client";
import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { WorkspaceScreen, WorkspaceVersion } from "../db/workspace-repository.ts";

type Props = { screen: WorkspaceScreen; current: WorkspaceVersion; busy: boolean; onImageError: () => void };
type Side = "left" | "right";
type ImageState = { attempt: number; status: "loading" | "ready" | "error" };

export default function VersionComparison({ screen, current, busy, onImageError }: Props) {
  const imageAttempt = useRef(0);
  // A fresh URL for every pair prevents the browser's decoded-image cache
  // from reusing an earlier authorized read after the session has expired.
  function nextImageAttempt() { return ++imageAttempt.current; }
  const versions = [...screen.versions].sort((a, b) => a.number - b.number);
  const index = versions.findIndex((version) => version.id === current.id);
  const [pair, setPair] = useState(() => ({
    left: versions[Math.max(0, index - 1)]!.number,
    right: versions[index > 0 ? index : 1]!.number,
  }));
  const [mode, setMode] = useState<"side" | "overlay">("side");
  const left = versions.find((version) => version.number === pair.left)!;
  const right = versions.find((version) => version.number === pair.right)!;
  function choose(side: Side, number: number) {
    const other = side === "left" ? "right" : "left";
    setPair((previous) => ({
      ...previous,
      [side]: number,
      [other]: number === previous[other] ? previous[side] : previous[other],
    }));
  }
  return (
    <section className="version-comparison" aria-label={`Compare versions of ${screen.title}`}>
      <div className="comparison-controls">
        <div className="comparison-selectors">
          {(["left", "right"] as const).map((side) => (
            <label key={side}>
              {side === "left" ? "Left version" : "Right version"}
              <select aria-label={side === "left" ? "Left version" : "Right version"}
                disabled={busy} value={String(pair[side])}
                onChange={(event) => choose(side, Number(event.target.value))}>
                {versions.map((version) => <option key={version.id} value={String(version.number)}>v{version.number}</option>)}
              </select>
            </label>
          ))}
          <button className="quiet" disabled={busy}
            onClick={() => setPair({ left: pair.right, right: pair.left })}>
            Swap versions <span aria-hidden="true">⇄</span>
          </button>
        </div>
        <div className="mode-buttons" aria-label="Comparison layout">
          <button className="secondary" aria-pressed={mode === "side"} disabled={busy}
            onClick={() => setMode("side")}>Side by side</button>
          <button className="secondary" aria-pressed={mode === "overlay"} disabled={busy}
            onClick={() => setMode("overlay")}>Overlay</button>
        </div>
      </div>
      <ComparisonImages key={`${left.assetId}:${right.assetId}`} title={screen.title}
        left={left} right={right} mode={mode} busy={busy} onImageError={onImageError}
        nextImageAttempt={nextImageAttempt} />
    </section>
  );
}

function ComparisonImages({ title, left, right, mode, busy, onImageError, nextImageAttempt }: {
  title: string; left: WorkspaceVersion; right: WorkspaceVersion;
  mode: "side" | "overlay"; busy: boolean; onImageError: () => void;
  nextImageAttempt: () => number;
}) {
  const [images, setImages] = useState<Record<Side, ImageState>>(() => ({
    left: { attempt: nextImageAttempt(), status: "loading" },
    right: { attempt: nextImageAttempt(), status: "loading" },
  }));
  const [reveal, setReveal] = useState(50);
  const pointer = useRef<number | null>(null);
  const width = Math.max(left.width, right.width);
  const height = Math.max(left.height, right.height);
  const geometry = {
    "--comparison-ratio": `${width} / ${height}`,
    "--comparison-width": `${width}px`,
    "--comparison-height-limit": `${(58 * width) / height}vh`,
  } as CSSProperties;
  function imageStatus(side: Side, attempt: number, status: ImageState["status"]) {
    setImages((previous) => previous[side].attempt === attempt
      ? { ...previous, [side]: { attempt, status } } : previous);
  }
  function drag(event: PointerEvent<HTMLDivElement>) {
    if (busy || mode !== "overlay") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width) setReveal(Math.round(Math.min(100, Math.max(0, (event.clientX - rect.left) / rect.width * 100))));
  }
  return (
    <div className="comparison-worktable" style={geometry}>
      <div className="comparison-legend">
        <span>Left · v{left.number} <small>{left.width} × {left.height} px</small></span>
        <span>Right · v{right.number} <small>{right.width} × {right.height} px</small></span>
      </div>
      <div className="comparison-image-status">
        {(["left", "right"] as const).map((side) => {
          const state = images[side];
          const label = side === "left" ? "Left" : "Right";
          if (state.status === "ready") return null;
          return <div key={side} role={state.status === "error" ? "alert" : "status"}>
            <p>{state.status === "loading" ? `Loading ${side} image…` : `${label} image could not be loaded.`}</p>
            {state.status === "error" && <button className="secondary" disabled={busy}
              onClick={() => {
                const attempt = nextImageAttempt();
                setImages((previous) => ({ ...previous, [side]: { attempt, status: "loading" } }));
              }}>
              Retry {side} image
            </button>}
          </div>;
        })}
      </div>
      <div className={`comparison-canvases ${mode === "overlay" ? "overlay-mode" : "side-mode"}`}
        data-testid={mode === "overlay" ? "comparison-overlay" : undefined}
        onPointerDown={(event) => {
          if (busy || mode !== "overlay" || !event.isPrimary || event.button !== 0) return;
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag(event);
        }}
        onPointerMove={(event) => { if (pointer.current === event.pointerId) drag(event); }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return;
          drag(event);
          pointer.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { pointer.current = null; }}
        onLostPointerCapture={() => { pointer.current = null; }}>
        {(["left", "right"] as const).map((side) => {
          const version = side === "left" ? left : right;
          const state = images[side];
          return <div key={side} className={`comparison-pane comparison-${side}`}
            style={mode === "overlay" && side === "left" ? { clipPath: `inset(0 ${100 - reveal}% 0 0)` } : undefined}>
            {state.status !== "error" && <img key={`${version.assetId}:${state.attempt}`}
              src={`/api/assets/${version.assetId}?attempt=${state.attempt}`}
              alt={`${side === "left" ? "Left" : "Right"}: ${title} v${version.number}`}
              width={version.width} height={version.height} draggable={false}
              style={{ width: `${version.width / width * 100}%`, visibility: state.status === "ready" ? "visible" : "hidden" }}
              onLoad={() => imageStatus(side, state.attempt, "ready")}
              onError={() => { imageStatus(side, state.attempt, "error"); onImageError(); }} />}
            {state.status !== "ready" && <span className="comparison-placeholder" aria-hidden="true">
              {state.status === "error" ? `${side === "left" ? "Left" : "Right"} image unavailable` : `Loading ${side} image…`}
            </span>}
          </div>;
        })}
        {mode === "overlay" && <div className="comparison-divider" aria-hidden="true" style={{ left: `${reveal}%` }}>
          <span>⇄</span>
        </div>}
      </div>
      {mode === "overlay" && <div className="comparison-reveal">
        <label htmlFor="comparison-reveal">Reveal left version <output>{reveal}%</output></label>
        <input id="comparison-reveal" aria-label="Reveal left version" type="range" min="0" max="100" step="1"
          disabled={busy} value={reveal} onChange={(event) => setReveal(Number(event.target.value))} />
        <p className="note">Drag across the image, or use the slider and arrow keys.</p>
      </div>}
      <p className="note comparison-caption">Same scale, aligned top-left. Blank space shows differences in image size or transparency.</p>
    </div>
  );
}
