# 台電備轉容量率整天曲線網頁

這是一個 TypeScript 全棧小服務，用來每 10 分鐘抓取台電官方資料，記錄今天的備轉容量率，並在公開網頁顯示整天曲線。

## 功能

- `/api/latest`：最新成功資料與最近抓取狀態。
- `/api/today`：台灣時間今天 00:00 到目前的資料點與統計。
- 前端網頁：折線圖、目前值、最高、最低、平均、最後更新時間、抓取狀態。
- Zeabur 部署：讀取 `PORT`，並自動使用 `DATABASE_URL`、`POSTGRES_URI` 或 `POSTGRES_CONNECTION_STRING`。
- 本機開發：未設定 `DATABASE_URL` 時，資料會存到 `data/reserve-readings.json`。

## 本機執行

```bash
npm install
npm run dev
```

開啟：

```text
http://localhost:3000
```

正式模式：

```bash
npm run build
npm start
```

## Zeabur 部署

1. 將此專案推到 GitHub。
2. 在 Zeabur 建立 Project，加入 Node.js Service。
3. 在同一個 Project 加入 PostgreSQL Service。
4. 確認 Node.js Service 有 PostgreSQL 自動注入變數，例如 `POSTGRES_URI` 或 `POSTGRES_CONNECTION_STRING`。
5. Zeabur 會依照 `package.json` 執行 build 與 start。

建議環境變數：

```text
NODE_ENV=production
COLLECT_INTERVAL_MS=600000
DATABASE_SSL=false
```

## 台電資料來源

預設會依序嘗試：

- `https://service.taipower.com.tw/data/opendata/apply/file/d006020/001.json`
- `https://www.taipower.com.tw/d006/loadGraph/loadGraph/data/loadpara.json`
- `https://www.taipower.com.tw/2289/2363/2367/2368/10266/normalPost`
- `https://www.taipower.com.tw/2289/2363/2367/2368/10265/normalPost`

第一個來源是政府資料開放平臺「台灣電力公司今日系統供需狀況」的台電官方 JSON，更新頻率為每 10 分鐘。

若台電官方站台回傳 WAF challenge 或暫時無法解析資料，系統不會改抓第三方來源；網頁會保留最後成功資料，並顯示最近抓取失敗原因。

## 測試

```bash
npm test
```
