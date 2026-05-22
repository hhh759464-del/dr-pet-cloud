-- 宠博士·云伴 — Supabase 数据库建表脚本
-- 在 Supabase 控制台的 SQL Editor 中执行此文件

-- 1. 宠物表
CREATE TABLE pets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'dog' CHECK (type IN ('dog', 'cat', 'other')),
  breed TEXT DEFAULT '',
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
  total_anxiety_count INTEGER DEFAULT 0
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

-- 6. 存储桶：安抚语音文件
-- 在 Supabase 控制台 Storage 页面手动创建名为 'soothing-voices' 的公开存储桶

-- RLS 策略
ALTER TABLE pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE soothing_voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE guard_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE anxiety_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

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
