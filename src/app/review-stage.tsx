"use client";
import { useRef, useState, type ComponentProps } from "react";
import type { WorkspaceScreen } from "../db/workspace-repository.ts";
import ReviewCanvas from "./review-canvas.tsx";
import VersionComparison from "./version-comparison.tsx";

type Props = ComponentProps<typeof ReviewCanvas> & { screen: WorkspaceScreen };

export default function ReviewStage({ screen, ...review }: Props) {
  const [comparing, setComparing] = useState(false);
  const sessionCheck = useRef<Promise<void> | null>(null);
  const canCompare = screen.versions.length > 1;
  function checkImageSession() {
    // An img error does not expose HTTP status. Ask the existing API handler
    // to check the session so an expired private view is cleared normally.
    if (!sessionCheck.current) {
      sessionCheck.current = review.execute(async () => {
        await review.request("/api/workspace");
      }).finally(() => { sessionCheck.current = null; });
    }
  }
  return (
    <div className="review-stage">
      <div className="review-mode-bar">
        <div className="mode-buttons" aria-label="Review mode">
          <button className="secondary" aria-pressed={!comparing}
            disabled={review.busy} onClick={() => setComparing(false)}>
            {comparing ? "Back to review" : "Review"}
          </button>
          <button className="secondary" aria-pressed={comparing}
            disabled={review.busy || !canCompare}
            aria-describedby={!canCompare ? "comparison-guidance" : undefined}
            onClick={() => setComparing(true)}>
            Compare versions
          </button>
        </div>
        {!canCompare && <p id="comparison-guidance" className="note">Upload another version to compare.</p>}
        {comparing && <p className="note">Your comments stay with review v{review.version.number}.</p>}
      </div>
      <div hidden={comparing}>
        <ReviewCanvas {...review} />
      </div>
      {comparing && <VersionComparison screen={screen} current={review.version} busy={review.busy}
        onImageError={checkImageSession} />}
    </div>
  );
}
