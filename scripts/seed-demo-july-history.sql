-- Seeder: wypełnia LIPIEC 2026 (nie sierpień) dwunastoma zakończonymi
-- treningami w rotacji Push/Pull/Legs dla konta froispro6969@gmail.com —
-- do wizualnej weryfikacji ekranu „Historia treningów" (selektor miesięcy,
-- karta miesięcznego podsumowania, lista sesji) dla miesiąca Lipiec 2026.
--
-- Idempotentny: przed zasiewem usuwa wszystkie sesje tego użytkownika
-- z lipca 2026 (kaskada usuwa też ćwiczenia i serie tych sesji).
-- Uruchamianie:
--   docker compose exec -T postgres psql -U gym -d gym < scripts/seed-demo-july-history.sql

DO $$
DECLARE
  v_user_id UUID := '325272e7-0764-43ec-aeff-5353cfb03fe8'; -- froispro6969@gmail.com

  -- Dni treningowe w lipcu 2026 — trzy sesje tygodniowo, cztery tygodnie.
  v_days INT[] := ARRAY[2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25, 28];

  v_plan_name TEXT;
  v_exercise_ids TEXT[];

  v_session_id UUID;
  v_session_exercise_id UUID;
  v_started TIMESTAMPTZ;
  v_finished TIMESTAMPTZ;
  v_set_time TIMESTAMPTZ;

  i INT;
  j INT;
  k INT;
  v_sets INT;
  v_weight INT;
BEGIN
  DELETE FROM training_sessions
  WHERE user_id = v_user_id
    AND started_at >= '2026-07-01T00:00:00+02'::timestamptz
    AND started_at <  '2026-08-01T00:00:00+02'::timestamptz;

  FOR i IN 1..array_length(v_days, 1) LOOP
    CASE i % 3
      WHEN 1 THEN -- Push: klata, barki, triceps
        v_plan_name := 'Push';
        v_exercise_ids := ARRAY[
          'a1000000-0000-0000-0000-000000000001', -- Wyciskanie sztangi na ławce
          'a1000000-0000-0000-0000-000000000004', -- Wyciskanie hantli nad głowę
          'a1000000-0000-0000-0000-000000000007', -- Pompki na poręczach
          'a1000000-0000-0000-0000-000000000010', -- Unoszenie ramion bokiem
          'a1000000-0000-0000-0000-000000000011'  -- Prostowanie ramion na wyciągu
        ];
      WHEN 2 THEN -- Pull: plecy, biceps
        v_plan_name := 'Pull';
        v_exercise_ids := ARRAY[
          'a1000000-0000-0000-0000-000000000002', -- Podciąganie na drążku
          'a1000000-0000-0000-0000-000000000008', -- Wiosłowanie sztangą
          'a1000000-0000-0000-0000-000000000005', -- Martwy ciąg
          'a1000000-0000-0000-0000-000000000006'  -- Uginanie ramion z hantlami
        ];
      ELSE -- Legs: nogi, pośladki
        v_plan_name := 'Legs';
        v_exercise_ids := ARRAY[
          'a1000000-0000-0000-0000-000000000003', -- Przysiad ze sztangą
          'a1000000-0000-0000-0000-000000000009', -- Wypychanie nóg na suwnicy
          'a1000000-0000-0000-0000-000000000014'  -- Rozciąganie łańcucha tylnego
        ];
    END CASE;

    v_started := make_timestamptz(2026, 7, v_days[i], 18, 0, 0, 'Europe/Warsaw');
    v_finished := v_started + make_interval(mins => 45 + (i * 3) % 20);

    INSERT INTO training_sessions (user_id, plan_id, plan_name, status, note, started_at, finished_at)
    VALUES (v_user_id, NULL, v_plan_name, 'completed', NULL, v_started, v_finished)
    RETURNING id INTO v_session_id;

    FOR j IN 1..array_length(v_exercise_ids, 1) LOOP
      INSERT INTO training_session_exercises
        (session_id, exercise_id, exercise_name, exercise_muscles, exercise_category, exercise_image_url, position)
      SELECT v_session_id, e.id, e.name, e.muscles, e.category, NULL, j - 1
      FROM exercises e
      WHERE e.id = v_exercise_ids[j]::uuid
      RETURNING id INTO v_session_exercise_id;

      -- Pierwsze (główne) ćwiczenie dostaje 4 serie, reszta po 3.
      v_sets := CASE WHEN j = 1 THEN 4 ELSE 3 END;
      v_weight := 20 + (i * 2) + (j * 5);
      v_set_time := v_started + make_interval(mins => 5 + j * 6);

      FOR k IN 1..v_sets LOOP
        INSERT INTO training_session_sets
          (session_exercise_id, position, planned_weight, planned_reps, planned_rir,
           actual_weight, actual_reps, actual_rir, completed, completed_at)
        VALUES (
          v_session_exercise_id, k,
          v_weight::text, '10', '2',
          v_weight::text, (10 - (k - 1))::text, GREATEST(0, 2 - (k - 1))::text,
          true, v_set_time + make_interval(mins => k * 3)
        );
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Zasiano % treningów lipca 2026 dla usera %', array_length(v_days, 1), v_user_id;
END $$;
