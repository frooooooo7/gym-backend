-- Seeder: kompletna zakończona sesja "Push" na 30.07.2026 dla konta
-- froispro6969@gmail.com — do wizualnej weryfikacji ekranu szczegółów sesji
-- (nagłówek, mapa mięśni, oś czasu, karty ćwiczeń).
--
-- Idempotentny: usuwa poprzedni zasiew po stałym ID sesji przed wstawieniem.
-- Uruchamianie:
--   docker compose exec -T postgres psql -U gym -d gym < scripts/seed-demo-push-session.sql

DO $$
DECLARE
  v_user_id   UUID := '325272e7-0764-43ec-aeff-5353cfb03fe8'; -- froispro6969@gmail.com
  v_session   UUID := 'b1900000-0000-4000-8000-000000000030';
  v_ex_bench  UUID := 'b1900000-0000-4000-8000-000000000031';
  v_ex_ohp    UUID := 'b1900000-0000-4000-8000-000000000032';
  v_ex_dips   UUID := 'b1900000-0000-4000-8000-000000000033';
  v_ex_lat    UUID := 'b1900000-0000-4000-8000-000000000034';
  v_ex_tri    UUID := 'b1900000-0000-4000-8000-000000000035';
BEGIN
  -- Sprzątanie poprzedniego zasiewu (kaskada usuwa exercises + sets).
  DELETE FROM training_sessions WHERE id = v_session;

  INSERT INTO training_sessions
    (id, user_id, plan_id, plan_name, status, note, started_at, finished_at)
  VALUES (
    v_session, v_user_id, NULL, 'Push',
    'completed',
    'Dobra sesja, klata i barki solidnie zmęczone.',
    '2026-07-30 17:30:00+02', '2026-07-30 18:25:00+02'
  );

  INSERT INTO training_session_exercises
    (id, session_id, exercise_id, exercise_name, exercise_muscles, exercise_category, exercise_image_url, position)
  VALUES
    (v_ex_bench, v_session, 'a1000000-0000-0000-0000-000000000001', 'Wyciskanie sztangi na ławce', ARRAY['chest','triceps'], 'compound', NULL, 0),
    (v_ex_ohp,   v_session, 'a1000000-0000-0000-0000-000000000004', 'Wyciskanie hantli nad głowę', ARRAY['shoulders','triceps'], 'compound', NULL, 1),
    (v_ex_dips,  v_session, 'a1000000-0000-0000-0000-000000000007', 'Pompki na poręczach', ARRAY['chest','triceps','shoulders'], 'calisthenics', NULL, 2),
    (v_ex_lat,   v_session, 'a1000000-0000-0000-0000-000000000010', 'Unoszenie ramion bokiem', ARRAY['shoulders'], 'isolation', NULL, 3),
    (v_ex_tri,   v_session, 'a1000000-0000-0000-0000-000000000011', 'Prostowanie ramion na wyciągu', ARRAY['triceps'], 'isolation', NULL, 4);

  -- Wyciskanie sztangi na ławce — 4 serie, progresja ciężaru w serii 2.
  INSERT INTO training_session_sets
    (session_exercise_id, position, planned_weight, planned_reps, planned_rir, actual_weight, actual_reps, actual_rir, completed, completed_at)
  VALUES
    (v_ex_bench, 1, '70',   '8', '2', '70',   '8', '2', true, '2026-07-30 17:31:00+02'),
    (v_ex_bench, 2, '70',   '8', '2', '72.5', '8', '2', true, '2026-07-30 17:34:00+02'),
    (v_ex_bench, 3, '75',   '6', '1', '75',   '6', '1', true, '2026-07-30 17:37:00+02'),
    (v_ex_bench, 4, '75',   '5', '0', '75',   '5', '0', true, '2026-07-30 17:40:00+02');

  -- Wyciskanie hantli nad głowę — 4 serie, progresja w serii 2.
  INSERT INTO training_session_sets
    (session_exercise_id, position, planned_weight, planned_reps, planned_rir, actual_weight, actual_reps, actual_rir, completed, completed_at)
  VALUES
    (v_ex_ohp, 1, '40',   '8', '2', '40',   '8', '2', true, '2026-07-30 17:46:00+02'),
    (v_ex_ohp, 2, '40',   '8', '2', '42.5', '8', '2', true, '2026-07-30 17:49:00+02'),
    (v_ex_ohp, 3, '42.5', '6', '1', '42.5', '6', '1', true, '2026-07-30 17:52:00+02'),
    (v_ex_ohp, 4, '42.5', '5', '0', '42.5', '5', '0', true, '2026-07-30 17:55:00+02');

  -- Pompki na poręczach — masa własna, brak ciężaru w polu weight.
  INSERT INTO training_session_sets
    (session_exercise_id, position, planned_weight, planned_reps, planned_rir, actual_weight, actual_reps, actual_rir, completed, completed_at)
  VALUES
    (v_ex_dips, 1, NULL, '12', '2', NULL, '12', '2', true, '2026-07-30 18:01:00+02'),
    (v_ex_dips, 2, NULL, '10', '1', NULL, '10', '1', true, '2026-07-30 18:04:00+02'),
    (v_ex_dips, 3, NULL, '8',  '0', NULL, '8',  '0', true, '2026-07-30 18:07:00+02');

  -- Unoszenie ramion bokiem — progresja w serii 3.
  INSERT INTO training_session_sets
    (session_exercise_id, position, planned_weight, planned_reps, planned_rir, actual_weight, actual_reps, actual_rir, completed, completed_at)
  VALUES
    (v_ex_lat, 1, '10', '12', '2', '10', '12', '2', true, '2026-07-30 18:12:00+02'),
    (v_ex_lat, 2, '10', '12', '1', '10', '12', '1', true, '2026-07-30 18:14:00+02'),
    (v_ex_lat, 3, '10', '10', '0', '12', '10', '0', true, '2026-07-30 18:16:00+02');

  -- Prostowanie ramion na wyciągu — 4. seria nieukończona (test stanu "odpuszczone").
  INSERT INTO training_session_sets
    (session_exercise_id, position, planned_weight, planned_reps, planned_rir, actual_weight, actual_reps, actual_rir, completed, completed_at)
  VALUES
    (v_ex_tri, 1, '25',   '12', '2', '25',   '12', '2', true,  '2026-07-30 18:20:00+02'),
    (v_ex_tri, 2, '25',   '10', '1', '27.5', '10', '1', true,  '2026-07-30 18:22:00+02'),
    (v_ex_tri, 3, '27.5', '9',  '0', '27.5', '9',  '0', true,  '2026-07-30 18:24:00+02'),
    (v_ex_tri, 4, '27.5', '8',  '0', NULL,   NULL, NULL, false, NULL);

  RAISE NOTICE 'Zasiano sesję push % dla usera %', v_session, v_user_id;
END $$;
