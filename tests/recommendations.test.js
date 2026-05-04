// 選股核心邏輯單元測試
// 執行方式：node --test tests/recommendations.test.js  (Node.js 18+)
// 或：npx vitest run tests/recommendations.test.js

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

// ─── 從 Edge Function 移植的純計算函式（與 index.ts / index.html 保持一致）─
function maClose(arr, n) {
  if (arr.length < n) return null
  return arr.slice(-n).reduce((s, x) => s + x.c, 0) / n
}

function isBullish(arr) {
  const close  = arr.length ? arr[arr.length - 1].c : null
  const ma60   = maClose(arr, 60)
  const ma120  = maClose(arr, 120)
  const ma240  = maClose(arr, 240)
  const annual = ma240 ?? ma120
  if (close == null || ma60 == null || ma120 == null || annual == null) return false
  return annual < ma120 && ma120 < ma60 && ma60 < close
}

function isVolUp(arr) {
  if (arr.length < 23) return false
  const r3  = arr.slice(-3).reduce((s, x)  => s + (x.v || 0), 0) / 3
  const r20 = arr.slice(-23, -3).reduce((s, x) => s + (x.v || 0), 0) / 20
  return r20 > 0 && (r3 / r20 - 1) >= 0.03
}

function isNetBuy(rec, days) {
  if (!rec || days < 3) return false
  const need = Math.min(3, days)
  return need >= 3
    && rec.foreign.length >= 3 && rec.foreign.slice(0, 3).every(v => v > 0)
    && rec.trust.length   >= 3 && rec.trust.slice(0, 3).every(v => v > 0)
}

function scoreStock(s, arr, t86) {
  const bullish = isBullish(arr)
  const volUp   = isVolUp(arr)
  const netBuy  = isNetBuy(t86.map[s.code], t86.days)
  const close   = arr.length ? arr[arr.length - 1].c : 0
  const prev    = arr.length >= 2 ? arr[arr.length - 2].c : 0
  const chg     = close && prev ? (close / prev - 1) * 100 : 0

  let score = 0
  if (bullish)     score += 3
  if (netBuy)      score += 2
  if (volUp)       score += 1
  if (s.tags.marg) score += 1
  if (s.tags.rev)  score += 1
  if (s.tags.eps)  score += 1

  return { code: s.code, name: s.name, tags: s.tags, close, chg, bullish, volUp, netBuy, score }
}

function rankPicks(scored) {
  return [...scored].sort((a, b) =>
    (b.score - a.score) ||
    (Number(b.netBuy) - Number(a.netBuy)) ||
    (Number(b.volUp)  - Number(a.volUp))  ||
    (b.chg   - a.chg)
  )
}

// ─── 測試輔助 ─────────────────────────────────────────────────────────────────

// 產生 n 筆均值為 base、線性遞增的 K 棒陣列
function makeLinearBars(n, base = 100, step = 0.1, vol = 1000) {
  return Array.from({ length: n }, (_, i) => ({ c: base + i * step, v: vol }))
}

// 產生 n 筆固定收盤價的 K 棒
function makeFlatBars(n, price = 100, vol = 1000) {
  return Array.from({ length: n }, () => ({ c: price, v: vol }))
}

// ─── maClose ─────────────────────────────────────────────────────────────────
describe('maClose', () => {
  test('資料筆數不足時回傳 null', () => {
    assert.equal(maClose(makeFlatBars(59, 100), 60), null)
  })

  test('恰好 n 筆時正確計算', () => {
    const bars = makeFlatBars(60, 50)
    assert.equal(maClose(bars, 60), 50)
  })

  test('超過 n 筆時取最後 n 筆', () => {
    // 前 60 筆 = 100，後 60 筆 = 200，MA60 應為 200
    const bars = [...makeFlatBars(60, 100), ...makeFlatBars(60, 200)]
    assert.equal(maClose(bars, 60), 200)
  })

  test('空陣列回傳 null', () => {
    assert.equal(maClose([], 1), null)
  })
})

// ─── isBullish ───────────────────────────────────────────────────────────────
describe('isBullish', () => {
  test('多頭排列：annual < MA120 < MA60 < close → true', () => {
    // 線性遞增：越新的收盤價越高，MA 數值 annual < MA120 < MA60 < close
    const bars = makeLinearBars(300, 100, 0.5)
    assert.equal(isBullish(bars), true)
  })

  test('平盤：所有均線相等 → false（沒有排列）', () => {
    const bars = makeFlatBars(300, 100)
    assert.equal(isBullish(bars), false)
  })

  test('空頭排列（線性遞減）→ false', () => {
    const bars = makeLinearBars(300, 200, -0.5)
    assert.equal(isBullish(bars), false)
  })

  test('資料不足 120 筆 → false', () => {
    const bars = makeLinearBars(100, 100, 0.5)
    assert.equal(isBullish(bars), false)
  })
})

// ─── isVolUp ─────────────────────────────────────────────────────────────────
describe('isVolUp', () => {
  test('近 3 日均量比前 20 日高 3% → true', () => {
    const base = makeFlatBars(20, 100, 1000)   // 前 20 日量 = 1000
    const recent = makeFlatBars(3, 100, 1040)  // 近 3 日量 = 1040（+4%）
    assert.equal(isVolUp([...base, ...recent]), true)
  })

  test('量增不足 3% → false', () => {
    const base   = makeFlatBars(20, 100, 1000)
    const recent = makeFlatBars(3, 100, 1020) // +2%
    assert.equal(isVolUp([...base, ...recent]), false)
  })

  test('量縮 → false', () => {
    const base   = makeFlatBars(20, 100, 1000)
    const recent = makeFlatBars(3, 100, 800)
    assert.equal(isVolUp([...base, ...recent]), false)
  })

  test('資料不足 23 筆 → false', () => {
    assert.equal(isVolUp(makeFlatBars(22, 100, 1000)), false)
  })

  test('前 20 日均量為 0 → false（避免除零）', () => {
    const base   = makeFlatBars(20, 100, 0)
    const recent = makeFlatBars(3, 100, 1000)
    assert.equal(isVolUp([...base, ...recent]), false)
  })
})

// ─── isNetBuy ────────────────────────────────────────────────────────────────
describe('isNetBuy', () => {
  test('外資 + 投信 連 3 日買超 → true', () => {
    const rec = { foreign: [100, 200, 300], trust: [50, 80, 60] }
    assert.equal(isNetBuy(rec, 3), true)
  })

  test('外資連 3 日買超但投信第 2 日賣超 → false', () => {
    const rec = { foreign: [100, 200, 300], trust: [50, -10, 60] }
    assert.equal(isNetBuy(rec, 3), false)
  })

  test('外資第 1 日賣超 → false', () => {
    const rec = { foreign: [-100, 200, 300], trust: [50, 80, 60] }
    assert.equal(isNetBuy(rec, 3), false)
  })

  test('days < 3 → false（資料天數不足）', () => {
    const rec = { foreign: [100, 200, 300], trust: [50, 80, 60] }
    assert.equal(isNetBuy(rec, 2), false)
  })

  test('rec 為 undefined → false', () => {
    assert.equal(isNetBuy(undefined, 3), false)
  })
})

// ─── scoreStock ──────────────────────────────────────────────────────────────
describe('scoreStock', () => {
  const mockStock = { code: '2330', name: '台積電', tags: { marg: true, rev: true, eps: true } }
  const emptyT86  = { map: {}, days: 0 }

  test('無任何條件成立：基礎分 = tags 分（marg+rev+eps = 3）', () => {
    const bars = makeFlatBars(300, 100)
    const result = scoreStock(mockStock, bars, emptyT86)
    assert.equal(result.score, 3)  // marg + rev + eps
    assert.equal(result.bullish, false)
    assert.equal(result.volUp,   false)
    assert.equal(result.netBuy,  false)
  })

  test('多頭排列命中：score += 3', () => {
    const bars = makeLinearBars(300, 100, 0.5)
    const result = scoreStock(mockStock, bars, emptyT86)
    assert.equal(result.bullish, true)
    assert.ok(result.score >= 6)  // 3(bullish) + 3(tags)
  })

  test('外資投信連買 + 多頭：score 最高', () => {
    const bars = makeLinearBars(300, 100, 0.5)
    const t86  = {
      days: 3,
      map: { '2330': { foreign: [100, 200, 300], trust: [50, 80, 60] } },
    }
    const result = scoreStock(mockStock, bars, t86)
    assert.equal(result.netBuy, true)
    assert.ok(result.score >= 8)  // 3+2+3 (無 volUp)
  })
})

// ─── rankPicks ───────────────────────────────────────────────────────────────
describe('rankPicks', () => {
  test('依 score 高到低排列', () => {
    const picks = [
      { code: 'A', score: 3, netBuy: false, volUp: false, chg: 0 },
      { code: 'B', score: 7, netBuy: false, volUp: false, chg: 0 },
      { code: 'C', score: 5, netBuy: false, volUp: false, chg: 0 },
    ]
    const ranked = rankPicks(picks)
    assert.deepEqual(ranked.map(p => p.code), ['B', 'C', 'A'])
  })

  test('score 相同時，有 netBuy 者排前面', () => {
    const picks = [
      { code: 'A', score: 5, netBuy: false, volUp: false, chg: 0 },
      { code: 'B', score: 5, netBuy: true,  volUp: false, chg: 0 },
    ]
    const ranked = rankPicks(picks)
    assert.equal(ranked[0].code, 'B')
  })

  test('score 和 netBuy 皆同時，有 volUp 者排前面', () => {
    const picks = [
      { code: 'A', score: 5, netBuy: true, volUp: false, chg: 2 },
      { code: 'B', score: 5, netBuy: true, volUp: true,  chg: 1 },
    ]
    const ranked = rankPicks(picks)
    assert.equal(ranked[0].code, 'B')
  })

  test('不修改原陣列（純函式）', () => {
    const picks = [
      { code: 'A', score: 3, netBuy: false, volUp: false, chg: 0 },
      { code: 'B', score: 7, netBuy: false, volUp: false, chg: 0 },
    ]
    const original = [...picks]
    rankPicks(picks)
    assert.deepEqual(picks, original)
  })
})
