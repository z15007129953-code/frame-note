ALTER TABLE versions ADD CONSTRAINT versions_workspace_id_project_id_id_unique UNIQUE (workspace_id, project_id, id);

CREATE TABLE comment_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version_id uuid NOT NULL,
  x double precision NOT NULL CONSTRAINT comment_threads_x_check CHECK (x BETWEEN 0 AND 1),
  y double precision NOT NULL CONSTRAINT comment_threads_y_check CHECK (y BETWEEN 0 AND 1),
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, project_id, version_id, id),
  FOREIGN KEY (workspace_id, project_id, version_id) REFERENCES versions (workspace_id, project_id, id)
);
CREATE INDEX comment_threads_version_order ON comment_threads (workspace_id, project_id, version_id, created_at, id);

CREATE TABLE comment_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  version_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL CONSTRAINT comment_messages_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, project_id, version_id, thread_id) REFERENCES comment_threads (workspace_id, project_id, version_id, id),
  FOREIGN KEY (workspace_id, author_id) REFERENCES members (workspace_id, id)
);
CREATE INDEX comment_messages_thread_order ON comment_messages (workspace_id, project_id, version_id, thread_id, created_at, id);
