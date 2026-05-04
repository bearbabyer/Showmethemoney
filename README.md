# 💰 Show Me The Money — 台股看盤系統

> 即時台股行情、法人籌碼、智慧選股、財經新聞整合儀表板

部署網址：https://allenchen1113official.github.io/Showmethemoney/

---

## 功能總覽

### 市場總覽
- TAIEX / OTC 大盤指數即時報價
- 期貨日盤 / 夜盤報價（TAIFEX）
- 三大法人買賣超彙總
- 景氣燈號（國發會 NDC）
- 財經行事曆

### 投資組合
- 上市 / 上櫃混合持股管理
- 持股成本與損益追蹤
- 拖曳排序
- Supabase 帳號登入，**跨裝置同步**

### 智慧選股推薦
- 技術面：均線多頭排列、量增 ≥3%
- 籌碼面：外資 + 投信**連續 3 日**淨買超（雙重確認）
- 基本面：本益比、殖利率、EPS 年增率、營益率、營收年增率
- 每日快照儲存至 Supabase，可回顧歷史推薦

### 新聞 & 情緒
- Google News 財經新聞（英文自動翻譯繁中）
- Reddit 討論（r/taiwan, r/investing 等）
- PTT 股票板
- 聯合新聞網財經

---

## 技術架構

| 層次 | 技術 |
|------|------|
| 前端 | Vanilla JavaScript / HTML5 / CSS3 |
| 後端 | Supabase（PostgreSQL + RLS） |
| 部署 | GitHub Pages |
| 字型 | Noto Sans TC / Inter（Google Fonts） |
| 圖示 | Font Awesome 6 |

### 資料來源 API
| 來源 | 用途 |
|------|------|
| TWSE（證交所） | 個股日 K、三大法人明細 |
| TPEX（櫃買中心） | 上櫃股報價、日 K |
| TAIFEX（期交所） | 台指期日盤 / 夜盤 |
| Yahoo Finance | 個股歷史與即時報價 |
| Goodinfo | 基本面（PE、殖利率、EPS） |
| NDC（國發會） | 景氣燈號 |
| Google News / Translate | 財經新聞與翻譯 |
| Reddit | 英文股市討論 |
| PTT | 中文股市討論 |
| UDN | 聯合財經新聞 |

### 快取架構
```
請求 → L1 localStorage（毫秒級）
      ↓ 過期
      L2 Supabase（秒級，跨裝置共享，TTL 可設定）
      ↓ 過期
      外部 API（網路請求）→ 回寫 L1 + L2
```

---

## 資料庫結構（Supabase）

### portfolios（個人投資組合）
| 欄位 | 型別 | 說明 |
|------|------|------|
| user_id | uuid PK | 對應 auth.users |
| stocks | jsonb | `{count, items[], sort}` |
| updated_at | timestamptz | 自動更新 |

RLS：4 條政策，僅允許本人讀寫。

### 公用快取表（13 張）
`api_cache` / `market_indices` / `stock_daily` / `stock_quotes` / `stock_fundamentals` / `institutional_flow` / `three_institutionals` / `business_cycle` / `news_items` / `recommendation_snapshots` / `translations` / `fin_calendar`

- 讀取：匿名與登入使用者皆可
- 寫入：僅登入使用者可回寫快取

---

## 快速開始

### 本地開發

**需求：Python 3.x**

```bash
cd /path/to/Showmethemoney
python serve.py
```

開啟瀏覽器前往 → http://127.0.0.1:8765

### Supabase 設定（完整功能需要）

1. 前往 [supabase.com](https://supabase.com) 新建專案
2. 至 **SQL Editor**，依序執行：
   ```
   supabase_setup.sql        ← portfolios 資料表 + RLS
   supabase_cache_setup.sql  ← 13 個快取資料表
   ```
3. 取得專案的 **URL** 與 **anon key**
4. 更新 `config.js` 填入你的憑證

### 部署至 GitHub Pages

```bash
# 需要安裝 GitHub CLI (gh)
chmod +x deploy.sh
./deploy.sh
```

部署後約 1–2 分鐘即可透過 GitHub Pages 網址存取。

---

## 專案結構

```
Showmethemoney/
├── index.html               # 主程式（完整 SPA，~192 KB）
├── config.js                # Supabase 憑證（AES-GCM 加密）
├── quotes.json              # 投資金句輪播資料（23 則）
├── supabase_setup.sql       # portfolios 資料表與 RLS
├── supabase_cache_setup.sql # 13 個公用快取資料表
├── serve.py                 # 本地 HTTP 開發伺服器（port 8765）
└── deploy.sh                # GitHub Pages 自動部署腳本
```

---

## 安全性說明

- `config.js` 使用 **AES-GCM** 加密 Supabase 金鑰，並以 hostname 作為解密條件，防止憑證被複製到其他網域使用
- 所有 Supabase 資料表皆啟用 **Row Level Security（RLS）**
- 個人投資組合以 `auth.uid() = user_id` 嚴格隔離，他人無法存取

---

## 授權

MIT License

---

*Made with ❤️ for Taiwan stock investors*
