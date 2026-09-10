CREATE TABLE demo_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  member_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id),
  FOREIGN KEY (workspace_id, member_id) REFERENCES members(workspace_id, id)
);
