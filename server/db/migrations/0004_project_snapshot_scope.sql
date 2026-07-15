ALTER TABLE project_snapshots
  ADD CONSTRAINT project_snapshots_project_id_id_unique UNIQUE (project_id, id);

ALTER TABLE projects
  DROP CONSTRAINT projects_saved_snapshot_fk,
  ADD CONSTRAINT projects_saved_snapshot_fk FOREIGN KEY (id, saved_snapshot_id)
    REFERENCES project_snapshots(project_id, id)
    ON DELETE SET NULL (saved_snapshot_id)
    DEFERRABLE INITIALLY IMMEDIATE;
