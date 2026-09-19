-- Telemetría (fase 0): qué pasa en el juego, para medir retención y qué se juega.
-- source = 'client' (lo manda el navegador) o 'server' (lo vio el servidor en una sala online: sirve para rankings).
CREATE TABLE events (
  id         BIGSERIAL PRIMARY KEY,
  player_id  INTEGER REFERENCES players(id) ON DELETE SET NULL,
  anon_id    TEXT,                          -- id anónimo del navegador (invitados y cuentas)
  kind       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  source     TEXT NOT NULL DEFAULT 'client',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_kind_time ON events (kind, created_at);
CREATE INDEX events_player_time ON events (player_id, created_at);
CREATE INDEX events_anon_time ON events (anon_id, created_at);

-- Quién jugó cada día (cuenta o navegador anónimo).
CREATE VIEW daily_players AS
SELECT created_at::date AS day, COALESCE('p' || player_id::text, 'a' || anon_id) AS who
FROM events
WHERE kind = 'session_start'
GROUP BY 1, 2;

-- Retención: de los que jugaron por primera vez cada día, cuántos volvieron al día siguiente y a los 7 días.
CREATE VIEW retention AS
WITH first AS (SELECT who, MIN(day) AS cohort FROM daily_players GROUP BY who)
SELECT
  f.cohort,
  COUNT(*) AS nuevos,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM daily_players d WHERE d.who = f.who AND d.day = f.cohort + 1)) AS volvieron_d1,
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM daily_players d WHERE d.who = f.who AND d.day BETWEEN f.cohort + 1 AND f.cohort + 7)) AS volvieron_d7
FROM first f
GROUP BY f.cohort
ORDER BY f.cohort DESC;
