-- Migration: add name_code to restaurants and riders
-- Handles existing rows by adding the column as nullable, backfilling
-- with a generated slug, then enforcing the NOT NULL + UNIQUE constraint.

-- Step 1: Add nullable columns (no-op if already present)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS name_code TEXT;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS name_code TEXT;

-- Step 2: Backfill existing rows that have no name_code yet
UPDATE restaurants
  SET name_code = 'rest-' || substr(id::text, 1, 8)
  WHERE name_code IS NULL;

UPDATE riders
  SET name_code = 'rider-' || substr(id::text, 1, 8)
  WHERE name_code IS NULL;

-- Step 3: Add UNIQUE constraints (skip if they already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_name_code_unique'
  ) THEN
    ALTER TABLE restaurants ADD CONSTRAINT restaurants_name_code_unique UNIQUE (name_code);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'riders_name_code_unique'
  ) THEN
    ALTER TABLE riders ADD CONSTRAINT riders_name_code_unique UNIQUE (name_code);
  END IF;
END$$;

-- Step 4: Enforce NOT NULL now that all rows have a value
ALTER TABLE restaurants ALTER COLUMN name_code SET NOT NULL;
ALTER TABLE riders ALTER COLUMN name_code SET NOT NULL;
