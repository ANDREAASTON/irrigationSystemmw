-- ============================================================
-- supabase_schema.sql
-- Smart Irrigation Monitor — Supabase Database Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================


-- ===========================================================
-- 1. SENSOR READINGS TABLE
--    Every reading from the Raspberry Pi is stored here.
-- ===========================================================
CREATE TABLE IF NOT EXISTS public.sensor_readings (
  id               BIGSERIAL PRIMARY KEY,

  -- Soil moisture sensor (MCP3008, channel 0)
  moisture_percent NUMERIC(5, 2),          -- e.g. 65.40
  moisture_status  TEXT,                   -- 'Wet' | 'Moist' | 'Dry'
  pump_state       BOOLEAN,                -- true = ON, false = OFF

  -- Ultrasonic sensor (TRIG GPIO 23 / ECHO GPIO 24)
  distance_cm      NUMERIC(7, 2),          -- e.g. 12.35  (NULL if timeout)
  object_detected  BOOLEAN,               -- true if distance < 10 cm

  -- LED states
  red_led_state    BOOLEAN,               -- true = ON (GPIO 27)
  green_led_state  BOOLEAN,               -- true = ON (GPIO 17)

  -- When the reading was taken
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast time-ordered queries
CREATE INDEX IF NOT EXISTS idx_sensor_readings_timestamp
  ON public.sensor_readings (timestamp DESC);


-- ===========================================================
-- 2. PROFILES TABLE (optional but recommended)
--    Automatically mirrors auth.users rows.
--    Extend this with extra user fields if needed later.
-- ===========================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create a profile row whenever a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ===========================================================
-- 3. ROW LEVEL SECURITY (RLS)
--    RLS must be enabled on every public table.
-- ===========================================================
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;


-- ===========================================================
-- 4. RLS POLICIES
-- ===========================================================

-- ---- sensor_readings ----------------------------------------

-- Authenticated users (dashboard viewers) can read all rows
CREATE POLICY "Authenticated users can read sensor_readings"
  ON public.sensor_readings
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT is NOT allowed from the frontend (anon or authenticated).
-- The Raspberry Pi uses the service_role key via a secure backend,
-- so no frontend INSERT policy is needed here.
-- See NOTES below for how the Pi should insert data.

-- ---- profiles -----------------------------------------------

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);


-- ===========================================================
-- 5. REALTIME
--    Enable realtime broadcasts for the sensor_readings table
--    so the dashboard updates instantly when a new row arrives.
-- ===========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_readings;


-- ===========================================================
-- NOTES ON RASPBERRY PI INSERTS
-- ===========================================================
-- Option A (Recommended for production):
--   Create a small server-side function (Supabase Edge Function)
--   that accepts a POST request from the Pi. The function runs
--   with service_role privileges and inserts the row.
--   The Pi sends a shared secret header instead of the service key.
--
-- Option B (Simple / development):
--   The Pi uses the service_role key directly in its Python code.
--   The service_role key bypasses RLS, so inserts always work.
--   NEVER put the service_role key in frontend HTML/JS files.
--   Store it only in the Pi's Python script or a .env file.
--
-- The SQL above does NOT create an INSERT policy for anon or
-- authenticated roles, keeping the frontend read-only.
-- ===========================================================
