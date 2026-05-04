-- ============================================================
-- Show Me The Money — 每日選股 Edge Function 排程設定
-- 使用方式：
--   1. Supabase Dashboard → SQL Editor 執行此腳本
--   2. 確認 pg_cron extension 已啟用（Database → Extensions → pg_cron）
--   3. 將 <PROJECT_REF> 換成你的 Supabase 專案 ID
--   4. 將 <ANON_KEY> 換成你的 anon key（或 service_role key）
-- ============================================================

-- 啟用 pg_cron（若尚未啟用）
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 每個交易日 14:30 (UTC+8 = 06:30 UTC) 觸發 Edge Function
-- cron 格式：分 時 日 月 星期
select cron.schedule(
  'daily-recommendations',       -- job 名稱（唯一）
  '30 6 * * 1-5',                -- 週一至週五 UTC 06:30
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-recommendations',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <ANON_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  )
  $$
);

-- 查看目前所有排程
-- select * from cron.job;

-- 手動立即執行一次（測試用）
-- select net.http_post(
--   url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/daily-recommendations',
--   headers := '{"Content-Type": "application/json", "Authorization": "Bearer <ANON_KEY>"}'::jsonb,
--   body    := '{}'::jsonb
-- );

-- 刪除排程（若需要重設）
-- select cron.unschedule('daily-recommendations');
