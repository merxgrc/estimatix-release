-- Pricing Tables Migration
-- Adds task_library, user_cost_library, and user_margin_rules tables with RLS policies

-- 1. Master Task Library (pricing seeds will be added later)
CREATE TABLE IF NOT EXISTS task_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_code VARCHAR(10) NOT NULL,
  description TEXT NOT NULL,
  unit VARCHAR(10) NOT NULL,        -- 'SF', 'LF', 'EA', etc.
  region VARCHAR(20),               -- 'Seattle', 'SoCal', NULL = national
  unit_cost_low DECIMAL(10,2),
  unit_cost_mid DECIMAL(10,2),
  unit_cost_high DECIMAL(10,2),
  labor_hours_per_unit DECIMAL(6,2),
  material_cost_per_unit DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(cost_code, description)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_task_library_cost_code ON task_library(cost_code);
CREATE INDEX IF NOT EXISTS idx_task_library_region ON task_library(region);


-- 2. User-Specific Cost Library (company overrides + actuals)
CREATE TABLE IF NOT EXISTS user_cost_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  task_library_id UUID REFERENCES task_library(id) ON DELETE CASCADE,
  custom_unit_cost DECIMAL(10,2),
  quantity DECIMAL(10,2),
  total_cost DECIMAL(12,2),
  notes TEXT,
  is_actual BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, task_library_id)
);

CREATE INDEX IF NOT EXISTS idx_user_cost_user_task ON user_cost_library(user_id, task_library_id);


-- 3. User Margin Rules
CREATE TABLE IF NOT EXISTS user_margin_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_name VARCHAR(50),
  min_margin DECIMAL(5,2),
  max_margin DECIMAL(5,2),
  default_margin DECIMAL(5,2),
  applies_to_cost_codes TEXT[],     -- e.g. ['201','530']
  created_at TIMESTAMP DEFAULT NOW()
);


-- RLS Policies ------------------------------------

-- task_library: public read
ALTER TABLE task_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_library public read"
  ON task_library
  FOR SELECT
  USING (true);


-- user_cost_library: user-specific read/write
ALTER TABLE user_cost_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_cost_library own read/write"
  ON user_cost_library
  FOR ALL
  USING (auth.uid() = user_id);


-- user_margin_rules: user-specific read/write
ALTER TABLE user_margin_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_margin_rules own read/write"
  ON user_margin_rules
  FOR ALL
  USING (auth.uid() = user_id);

