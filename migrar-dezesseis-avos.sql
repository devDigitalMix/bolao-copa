-- Migrar jogos do mata-mata inseridos como "Grupos" para "Dezesseis avos"
-- Aplica a todos os jogos com data >= 28/06/2026 que ainda estejam como fase Grupos.
-- Cole isso no SQL Editor do Supabase e execute.

UPDATE games
SET phase = 'Dezesseis avos'
WHERE phase = 'Grupos'
  AND date >= '2026-06-28';

-- Verifique antes de executar (opcional):
-- SELECT id, team_a, team_b, date, phase FROM games WHERE phase = 'Grupos' AND date >= '2026-06-28' ORDER BY date;
