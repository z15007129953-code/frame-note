"use client";
import { useRef, useState, type ComponentProps } from "react";
import type { WorkspaceScreen } from "../db/workspace-repository.ts";
import ReviewCanvas from "./review-canvas.tsx";
import VersionComparison from "./version-comparison.tsx";
import { useLanguage } from "./i18n";

type Props = ComponentProps<typeof ReviewCanvas> & { screen: WorkspaceScreen };

export default function ReviewStage({ screen, ...review }: Props) {
  const { t } = useLanguage();
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
        <div className="mode-buttons" aria-label={t("review")}>
          <button className="secondary" aria-pressed={!comparing}
            disabled={review.busy} onClick={() => setComparing(false)}>
            {comparing ? t("backReview") : t("review")}
          </button>
          <button className="secondary" aria-pressed={comparing}
            aria-label="Compare versions"
            disabled={review.busy || !canCompare}
            aria-describedby={!canCompare ? "comparison-guidance" : undefined}
            onClick={() => setComparing(true)}>
            {t("compare")}
          </button>
        </div>
        {!canCompare && <p id="comparison-guidance" className="note">{t("uploadAnother")}</p>}
        {comparing && <p className="note">{t("commentsStay", { n: review.version.number })}</p>}
      </div>
      <div hidden={comparing}>
        <ReviewCanvas {...review} />
      </div>
      {comparing && <VersionComparison screen={screen} current={review.version} busy={review.busy}
        onImageError={checkImageSession} />}
    </div>
  );
}
