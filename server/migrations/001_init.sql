-- Jugadores, sus cosas, sus logros y sus sesiones.
CREATE TABLE players (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  name_key    TEXT NOT NULL UNIQUE,          -- nombre en minúsculas, para que no se repita
  pass_hash   TEXT NOT NULL,
  xp          INTEGER NOT NULL DEFAULT 0,
  coins       INTEGER NOT NULL DEFAULT 0,
  stats       JSONB NOT NULL DEFAULT '{}',
  look        JSONB NOT NULL DEFAULT '{}',
  design      JSONB NOT NULL DEFAULT '{}',
  gear        JSONB NOT NULL DEFAULT '{}',
  captured    JSONB NOT NULL DEFAULT '[]',   -- diseños de volantines capturados
  last_report TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item      TEXT NOT NULL,                   -- "kind:id", ej. "line:curado"
  bought_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, item)
);

CREATE TABLE achievements (
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, achievement_id)
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_player ON sessions(player_id);

-- Partidas: se llenará con el modo online (fase 3).
CREATE TABLE matches (
  id         SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ,
  result     JSONB NOT NULL DEFAULT '{}'
);
