ALTER TABLE shares
  ADD COLUMN allow_comments boolean NOT NULL DEFAULT false;

ALTER TABLE shares
  ADD CONSTRAINT shares_workspace_id_project_id_id_unique UNIQUE (workspace_id, project_id, id);

ALTER TABLE comment_messages
  ALTER COLUMN author_id DROP NOT NULL,
  ADD COLUMN guest_share_id uuid;

ALTER TABLE comment_messages
  ADD CONSTRAINT comment_messages_author_check
    CHECK ((author_id IS NULL) <> (guest_share_id IS NULL)),
  ADD CONSTRAINT comment_messages_guest_share_fk
    FOREIGN KEY (workspace_id, project_id, guest_share_id)
    REFERENCES shares (workspace_id, project_id, id);

CREATE INDEX comment_messages_guest_share_order
  ON comment_messages (workspace_id, project_id, guest_share_id, created_at, id)
  WHERE guest_share_id IS NOT NULL;
