-- 宠博士·云伴 — Supabase 数据库建表脚本
-- 在 Supabase 控制台的 SQL Editor 中执行此文件

-- 1. 宠物表
CREATE TABLE pets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'dog' CHECK (type IN ('dog', 'cat', 'other')),
  breed TEXT DEFAULT '',
  body_size TEXT DEFAULT 'medium' CHECK (body_size IN ('small', 'medium', 'large')),
  avatar_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 安抚语音表
CREATE TABLE soothing_voices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  duration_sec INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 守护会话表
CREATE TABLE guard_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  total_anxiety_count INTEGER DEFAULT 0,
  mode TEXT DEFAULT 'guard' CHECK (mode IN ('guard', 'mark'))
);

-- 4. 焦虑事件表
CREATE TABLE anxiety_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES guard_sessions(id) ON DELETE CASCADE NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL,
  duration_sec INTEGER DEFAULT 3,
  peak_db REAL DEFAULT 0,
  voice_played_id UUID REFERENCES soothing_voices(id)
);

-- 5. 每日报告表
CREATE TABLE daily_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  summary_text TEXT DEFAULT '',
  stats_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pet_id, date)
);

-- 6. 宠物校准记录表
CREATE TABLE pet_calibrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  E_base INTEGER NOT NULL,
  P_peak INTEGER,
  threshold INTEGER NOT NULL,
  body_size TEXT DEFAULT 'medium' CHECK (body_size IN ('small', 'medium', 'large')),
  source TEXT DEFAULT 'calibration' CHECK (source IN ('calibration', 'body_size_fallback', 'manual_correction')),
  calibrated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. 音频片段表（标记模式录制的声音）
CREATE TABLE audio_snippets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  session_id UUID REFERENCES guard_sessions(id) ON DELETE SET NULL,
  peak_db INTEGER NOT NULL,
  audio_url TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  label BOOLEAN,  -- NULL=未标记, TRUE=是狗叫, FALSE=不是
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. 存储桶
-- 在 Supabase 控制台 Storage 页面手动创建以下公开存储桶：
--   - 'soothing-voices'：安抚语音文件（已有）
--   - 'audio_snippets'：标记模式录制的音频片段

-- RLS 策略
ALTER TABLE pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE soothing_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE guard_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE anxiety_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_snippets ENABLE ROW LEVEL SECURITY;

-- pets: 用户只能操作自己的宠物
CREATE POLICY "Users manage own pets" ON pets
  FOR ALL USING (auth.uid() = owner_id);

-- soothing_voices: 用户通过宠物关联操作
CREATE POLICY "Users manage own voices" ON soothing_voices
  FOR ALL USING (EXISTS (
    SELECT 1 FROM pets WHERE pets.id = soothing_voices.pet_id AND pets.owner_id = auth.uid()
  ));

-- guard_sessions: 通过宠物关联
CREATE POLICY "Users manage own sessions" ON guard_sessions
  FOR ALL USING (EXISTS (
    SELECT 1 FROM pets WHERE pets.id = guard_sessions.pet_id AND pets.owner_id = auth.uid()
  ));

-- anxiety_events: 通过会话关联
CREATE POLICY "Users manage own events" ON anxiety_events
  FOR ALL USING (EXISTS (
    SELECT 1 FROM guard_sessions
    JOIN pets ON pets.id = guard_sessions.pet_id
    WHERE guard_sessions.id = anxiety_events.session_id AND pets.owner_id = auth.uid()
  ));

-- daily_reports: 通过宠物关联
CREATE POLICY "Users manage own reports" ON daily_reports
  FOR ALL USING (EXISTS (
    SELECT 1 FROM pets WHERE pets.id = daily_reports.pet_id AND pets.owner_id = auth.uid()
  ));

-- pet_calibrations: 通过宠物关联
CREATE POLICY "Users manage own calibrations" ON pet_calibrations
  FOR ALL USING (EXISTS (
    SELECT 1 FROM pets WHERE pets.id = pet_calibrations.pet_id AND pets.owner_id = auth.uid()
  ));

-- audio_snippets: 通过宠物关联
CREATE POLICY "Users manage own snippets" ON audio_snippets
  FOR ALL USING (EXISTS (
    SELECT 1 FROM pets WHERE pets.id = audio_snippets.pet_id AND pets.owner_id = auth.uid()
  ));
