// Supabase Edge Function — 每日收盤後自動計算選股推薦
// 部署：supabase functions deploy daily-recommendations
// 觸發：由 pg_cron 每個交易日 14:30 (UTC+8) 呼叫，或 HTTP POST 手動觸發

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── 選股標的池（與 index.html 保持一致）────────────────────────────────────
const REC_UNIVERSE = [
  { code: '2330', name: '台積電',  tags: { marg: true,  rev: true,  eps: true  } },
  { code: '2454', name: '聯發科',  tags: { marg: true,  rev: true,  eps: true  } },
  { code: '2382', name: '廣達',    tags: { marg: false, rev: true,  eps: true  } },
  { code: '2383', name: '台光電',  tags: { marg: true,  rev: true,  eps: true  } },
  { code: '2395', name: '研華',    tags: { marg: true,  rev: true,  eps: true  } },
  { code: '3231', name: '緯創',    tags: { marg: false, rev: true,  eps: true  } },
  { code: '3661', name: '世芯-KY', tags: { marg: true,  rev: true,  eps: true  } },
  { code: '3037', name: '欣興',    tags: { marg: true,  rev: false, eps: true  } },
  { code: '5274', name: '信驊',    tags: { marg: true,  rev: true,  eps: true  } },
  { code: '6669', name: '緯穎',    tags: { marg: false, rev: true,  eps: true  } },
  { code: '3443', name: '創意',    tags: { marg: true,  rev: true,  eps: true  } },
  { code: '8069', name: '元太',    tags: { marg: true,  rev: true,  eps: true  } },
  { code: '3017', name: '奇鋐',    tags: { marg: true,  rev: true,  eps: true  } },
  { code: '2308', name: '台達電',  tags: { marg: true,  rev: true,  eps: true  } },
  { code: '2345', name: '智邦',    tags: { marg: true,  rev: true,  eps: true  } },
  { code: '4966', name: '譜瑞-KY', tags: { marg: true,  rev: true,  eps: true  } },
]

// ─── 型別定義 ────────────────────────────────────────────────────────────────
interface Bar { c: number; v: number }
interface StockTags { marg: boolean; rev: boolean; eps: boolean }
interface StockDef  { code: string; name: string; tags: StockTags }
interface T86Entry  { foreign: number[]; trust: number[] }
interface T86Result { map: Record<string, T86Entry>; days: number }
interface ScoredStock {
  code: string; name: string; tags: StockTags
  close: number; chg: number
  bullish: boolean; volUp: boolean; netBuy: boolean; score: number
}

// ─── 純計算函式（可獨立測試）─────────────────────────────────────────────────

export function maClose(arr: Bar[], n: number): number | null {
  if (arr.length < n) return null
  return arr.slice(-n).reduce((s, x) => s + x.c, 0) / n
}

export function isBullish(arr: Bar[]): boolean {
  const close  = arr.length ? arr[arr.length - 1].c : null
  const ma60   = maClose(arr, 60)
  const ma120  = maClose(arr, 120)
  const ma240  = maClose(arr, 240)
  const annual = ma240 ?? ma120
  if (close == null || ma60 == null || ma120 == null || annual == null) return false
  return annual < ma120 && ma120 < ma60 && ma60 < close
}

export function isVolUp(arr: Bar[]): boolean {
  if (arr.length < 23) return false
  const r3  = arr.slice(-3).reduce((s, x) => s + (x.v || 0), 0) / 3
  const r20 = arr.slice(-23, -3).reduce((s, x) => s + (x.v || 0), 0) / 20
  return r20 > 0 && (r3 / r20 - 1) >= 0.03
}

export function isNetBuy(rec: T86Entry | undefined, days: number): boolean {
  if (!rec || days < 3) return false
  const need = Math.min(3, days)
  return need >= 3
    && rec.foreign.length >= 3 && rec.foreign.slice(0, 3).every(v => v > 0)
    && rec.trust.length   >= 3 && rec.trust.slice(0, 3).every(v => v > 0)
}

export function scoreStock(
  s: StockDef,
  arr: Bar[],
  t86: T86Result,
): ScoredStock {
  const bullish = isBullish(arr)
  const volUp   = isVolUp(arr)
  const netBuy  = isNetBuy(t86.map[s.code], t86.days)
  const close   = arr.length ? arr[arr.length - 1].c : 0
  const prev    = arr.length >= 2 ? arr[arr.length - 2].c : 0
  const chg     = close && prev ? (close / prev - 1) * 100 : 0

  let score = 0
  if (bullish)    score += 3
  if (netBuy)     score += 2
  if (volUp)      score += 1
  if (s.tags.marg) score += 1
  if (s.tags.rev)  score += 1
  if (s.tags.eps)  score += 1

  return { code: s.code, name: s.name, tags: s.tags, close, chg, bullish, volUp, netBuy, score }
}

export function rankPicks(scored: ScoredStock[]): ScoredStock[] {
  return [...scored].sort((a, b) =>
    (b.score   - a.score)  ||
    (Number(b.netBuy) - Number(a.netBuy)) ||
    (Number(b.volUp)  - Number(a.volUp))  ||
    (b.chg     - a.chg)
  )
}

// ─── 資料抓取 ─────────────────────────────────────────────────────────────────

async function fetchYfHistory(code: string): Promise<Bar[]> {
  const sym = code + '.TW'
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y`
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(12000),
    })
    if (!r.ok) return []
    const j = await r.json()
    const res    = j?.chart?.result?.[0]
    const closes = res?.indicators?.quote?.[0]?.close  || []
    const vols   = res?.indicators?.quote?.[0]?.volume || []
    return closes
      .map((c: number | null, i: number) => ({ c, v: vols[i] || 0 }))
      .filter((x: Bar) => x.c != null) as Bar[]
  } catch {
    return []
  }
}

// TWSE T86：近 N 個交易日的三大法人個股資料
async function fetchT86(yyyymmdd: string): Promise<Record<string, any> | null> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${yyyymmdd}&selectType=ALL&response=json`
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

function tradingDaysBack(n: number): string[] {
  const days: string[] = []
  const d = new Date()
  while (days.length < n) {
    d.setDate(d.getDate() - 1)
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      days.push(d.toISOString().slice(0, 10).replace(/-/g, ''))
    }
  }
  return days
}

async function get3DayT86(): Promise<T86Result> {
  const dates = tradingDaysBack(5)
  const results: Array<Record<string, any> | null> = []
  for (const d of dates) {
    if (results.filter(Boolean).length >= 3) break
    const j = await fetchT86(d)
    results.push(j)
  }

  const map: Record<string, T86Entry> = {}
  let days = 0
  for (const j of results) {
    if (!j?.data) continue
    days++
    for (const row of j.data as string[][]) {
      const code = row[0]?.replace(/\s/g, '')
      if (!code) continue
      if (!map[code]) map[code] = { foreign: [], trust: [] }
      map[code].foreign.push(parseFloat((row[4] || '0').replace(/,/g, '')))
      map[code].trust.push(  parseFloat((row[7] || '0').replace(/,/g, '')))
    }
  }
  return { map, days }
}

// ─── 最近交易日 YYYY-MM-DD ────────────────────────────────────────────────────
function lastTradingDayKey(): string {
  const d = new Date()
  // 收盤 13:30，14:00 後視為當日完成
  const minutesNow = d.getHours() * 60 + d.getMinutes()
  // Edge Function 執行於 UTC；台灣 = UTC+8
  const twhour = (d.getUTCHours() + 8) % 24
  const twhmin = twhour * 60 + d.getUTCMinutes()
  if (twhmin < 14 * 60) d.setUTCDate(d.getUTCDate() - 1)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // 允許 Supabase Dashboard 的 OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const tradeDate = lastTradingDayKey()

  // 已有今日快照 → 直接回傳，不重複計算
  const { data: existing } = await supabase
    .from('recommendation_snapshots')
    .select('picks, generated_at')
    .eq('trade_date', tradeDate)
    .maybeSingle()

  if (existing?.picks?.length) {
    return Response.json({
      trade_date: tradeDate,
      cached: true,
      picks: existing.picks,
      generated_at: existing.generated_at,
    })
  }

  // 並行抓取所有標的歷史 + T86
  const [histories, t86] = await Promise.all([
    Promise.all(REC_UNIVERSE.map(s => fetchYfHistory(s.code).catch(() => [] as Bar[]))),
    get3DayT86().catch(() => ({ map: {}, days: 0 } as T86Result)),
  ])

  const scored = REC_UNIVERSE.map((s, i) => scoreStock(s, histories[i], t86))
  const top5   = rankPicks(scored).slice(0, 5)

  const generatedAt = new Date().toISOString()
  await supabase.from('recommendation_snapshots').upsert(
    { trade_date: tradeDate, picks: top5, generated_at: generatedAt },
    { onConflict: 'trade_date' },
  )

  console.log(`[daily-recommendations] ${tradeDate} → top5: ${top5.map(s => s.code).join(', ')}`)

  return Response.json({ trade_date: tradeDate, cached: false, picks: top5, generated_at: generatedAt })
})
