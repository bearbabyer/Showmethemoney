// Supabase Edge Function — market-proxy
// 作為 Server-side proxy，解決瀏覽器 CORS 限制
// 支援：台指期日盤、台指期夜盤、TAIEX、OTC

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'txf_day'
  const ts   = Date.now()

  const targets: Record<string, string> = {
    txf_day:   `https://openapi.taifex.com.tw/v1/DailyFuturesQuotes?CommodityID=TXF&_=${ts}`,
    txf_night: `https://openapi.taifex.com.tw/v1/NightFuturesQuotes?CommodityID=TXF&_=${ts}`,
    txf_mis:   `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_TXFR1.tw&json=1&delay=0&_=${ts}`,
    taiex:     `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0&_=${ts}`,
    otc:       `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_o00.tw&json=1&delay=0&_=${ts}`,
  }

  const url = targets[type]
  if (!url) return Response.json({ error: 'unknown type' }, { status: 400, headers: CORS })

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`)
    const data = await r.json()
    return Response.json(data, { headers: CORS })
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 502, headers: CORS })
  }
})
