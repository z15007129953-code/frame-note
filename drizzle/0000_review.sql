CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT current_timestamp
);
CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (workspace_id, id)
);
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (workspace_id, id)
);
CREATE TABLE project_members (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  member_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'collaborator', 'owner')),
  PRIMARY KEY (workspace_id, project_id, member_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id),
  FOREIGN KEY (workspace_id, member_id) REFERENCES members(workspace_id, id)
);
CREATE TABLE presentations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id)
);
CREATE TABLE screens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  presentation_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (workspace_id, project_id, id),
  CONSTRAINT screens_presentation_position UNIQUE (presentation_id, position) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, project_id, presentation_id) REFERENCES presentations(workspace_id, project_id, id)
);
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE CHECK (length(storage_key) > 0),
  mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  status text NOT NULL CHECK (status IN ('pending', 'ready')),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id)
);
CREATE TABLE versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  screen_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  number integer NOT NULL CHECK (number BETWEEN 1 AND 50),
  created_at timestamptz NOT NULL DEFAULT current_timestamp,
  UNIQUE (screen_id, number),
  UNIQUE (screen_id, asset_id),
  FOREIGN KEY (workspace_id, project_id, screen_id) REFERENCES screens(workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id, asset_id) REFERENCES assets(workspace_id, project_id, id)
);
CREATE FUNCTION frame_note_immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Version records are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER versions_immutable BEFORE UPDATE OR DELETE ON versions
  FOR EACH ROW EXECUTE FUNCTION frame_note_immutable_version();
