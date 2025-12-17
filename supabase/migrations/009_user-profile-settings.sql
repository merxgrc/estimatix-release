-- User Profile Settings Migration
-- Adds user_profile_settings table for storing user pricing preferences

CREATE TABLE IF NOT EXISTS user_profile_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  region VARCHAR(50),
  quality VARCHAR(20),      -- "Budget", "Standard", "Premium"
  default_margin DECIMAL(5,2),
  main_trades TEXT[],       -- ['Kitchen', 'Bath', 'Cabinets']

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profile_settings_user_id ON user_profile_settings(user_id);

-- Enable RLS
ALTER TABLE user_profile_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "user_profile_settings select" ON user_profile_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_profile_settings insert" ON user_profile_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_profile_settings update" ON user_profile_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_profile_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profile_settings_updated_at
  BEFORE UPDATE ON user_profile_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_profile_settings_updated_at();









