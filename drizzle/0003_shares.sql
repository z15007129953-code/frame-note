CREATE TABLE shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  presentation_id uuid NOT NULL,
  issuer_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, project_id, presentation_id) REFERENCES presentations (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, issuer_id) REFERENCES members (workspace_id, id)
);
CREATE INDEX shares_presentation_order ON shares (workspace_id, project_id, presentation_id, created_at, id);
