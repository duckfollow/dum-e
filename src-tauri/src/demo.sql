BEGIN;
CREATE TABLE missions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL, assigned_to TEXT, progress INTEGER NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO missions VALUES
(1,'Mark II flight systems','In progress','High','Tony Stark',78,'2026-10-24 09:42:00'),
(2,'Arc reactor diagnostics','Complete','High','Dum-E',100,'2026-10-24 09:31:00'),
(3,'Workshop inventory','In progress','Medium','U',64,'2026-10-24 09:18:00'),
(4,'Suit telemetry pipeline','Review','High','J.A.R.V.I.S.',92,'2026-10-24 08:55:00'),
(5,'Backup power supply','Queued','Low',NULL,0,'2026-10-23 17:22:00'),
(6,'Lab access controls','Complete','Medium','Pepper Potts',100,'2026-10-23 16:40:00'),
(7,'Assembly arm calibration','In progress','Medium','Dum-E',43,'2026-10-23 15:10:00'),
(8,'Cooling system checks','Queued','Low','U',0,'2026-10-23 14:08:00'),
(9,'Prototype materials','Review','Medium','Tony Stark',86,'2026-10-22 11:30:00'),
(10,'Emergency protocols','Complete','High','J.A.R.V.I.S.',100,'2026-10-22 10:15:00'),
(11,'Workshop cleanup','Queued','Low','Dum-E',12,'2026-10-22 09:00:00'),
(12,'Sensor integration','In progress','Medium','U',57,'2026-10-21 16:45:00');
CREATE TABLE crew (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, active INTEGER NOT NULL DEFAULT 1);
INSERT INTO crew VALUES (1,'Tony Stark','Engineer',1),(2,'Pepper Potts','Operations',1),(3,'Dum-E','Workshop assistant',1),(4,'U','Workshop assistant',1);
CREATE TABLE equipment (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, metadata TEXT);
INSERT INTO equipment VALUES (1,'Arc reactor','Power','{"generation":2,"output":"3 GW"}'),(2,'Assembly arm','Robotics','{"axes":6}'),(3,'Flight stabilizer','Avionics',NULL);
CREATE TABLE query_notes (id INTEGER PRIMARY KEY, title TEXT, sql_text TEXT);
INSERT INTO query_notes VALUES (1,'Active missions','SELECT * FROM missions WHERE status = ''In progress'';');
CREATE VIEW active_missions AS SELECT * FROM missions WHERE status='In progress';
CREATE TABLE mission_assignments (
 mission_id INTEGER NOT NULL,
 crew_id INTEGER NOT NULL,
 role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','reviewer')),
 active INTEGER NOT NULL DEFAULT 1,
 display_label TEXT GENERATED ALWAYS AS ('mission-' || mission_id) VIRTUAL,
 PRIMARY KEY(mission_id,crew_id),
 FOREIGN KEY(mission_id) REFERENCES missions(id) ON DELETE CASCADE,
 FOREIGN KEY(crew_id) REFERENCES crew(id) ON DELETE RESTRICT
) WITHOUT ROWID, STRICT;
INSERT INTO mission_assignments(mission_id,crew_id,role) VALUES (1,1,'owner'),(1,3,'reviewer'),(2,3,'owner'),(3,4,'owner'),(7,3,'owner');
CREATE UNIQUE INDEX idx_assignment_owner ON mission_assignments(mission_id) WHERE role='owner';
CREATE INDEX idx_assignment_crew ON mission_assignments(crew_id,mission_id);
CREATE TABLE mission_events (
 id INTEGER PRIMARY KEY,
 mission_id INTEGER NOT NULL,
 crew_id INTEGER NOT NULL,
 parent_event_id INTEGER REFERENCES mission_events(id),
 message TEXT NOT NULL,
 FOREIGN KEY(mission_id,crew_id) REFERENCES mission_assignments(mission_id,crew_id) ON UPDATE CASCADE ON DELETE CASCADE
);
INSERT INTO mission_events VALUES (1,1,1,NULL,'Flight systems inspection started'),(2,1,1,1,'Stabilizers calibrated'),(3,2,3,NULL,'Diagnostics complete');
COMMIT;
