# GitHub 發布與長期升級規格

## 1. 固定公開入口

- 正式站：`https://orsinobbb.github.io/starcare-hollow/`
- `main` 是唯一正式發布分支。
- Pull Request 只執行品質檢查，不會改動正式網站。
- 合併或直接推送至 `main` 後，GitHub Actions 會先測試，再把 `prototype/` 發布成網站根目錄。

這個安排讓未來即使從原生 JavaScript 改成 Vite、Godot Web 或其他建置工具，玩家網址仍可維持不變；屆時只需調整 workflow 的測試、建置命令與 artifact 路徑。

## 2. 日常升級流程

1. 從 `main` 建立 `feature/簡短名稱` 分支。
2. 完成功能後執行 `cd prototype` 與 `npm run check`。
3. 實測桌面、390×844 手機、鍵盤與觸控／滑鼠操作。
4. 玩家可見變更寫入 `CHANGELOG.md` 的 `Unreleased`。
5. 建立 Pull Request；自動測試通過後再合併。
6. 合併至 `main` 後確認 `github-pages` environment 顯示成功，再實玩公開網址。

緊急回復時，優先 revert 問題 commit 並重新部署；不要覆寫遠端歷史。

## 3. 版本規則

- PATCH，例如 `0.1.1`：修正錯字、視覺或不改玩法的錯誤。
- MINOR，例如 `0.2.0`：新增角色、關卡、收集系統或相容的新功能。
- MAJOR，例如 `1.0.0`：正式版，或有意不相容的系統／存檔變更。

發布時必須同步：

- `prototype/package.json` 的 `version`
- `prototype/src/version.js` 的 `APP_VERSION`
- `CHANGELOG.md` 的版本與日期
- Git tag，例如 `v0.2.0`

自動化測試會阻止前兩個版本號不一致的版本部署。

## 4. 存檔向前相容

自 `0.2.0` 起，小鎮進度會自動保存於玩家瀏覽器。第一版資料格式為：

```json
{
  "schemaVersion": 1,
  "gameVersion": "0.2.0",
  "savedAt": "ISO-8601 timestamp",
  "profile": {
    "schemaVersion": 1,
    "day": 1,
    "restoration": 0,
    "resources": {},
    "buildings": {},
    "daily": {},
    "lifetime": {},
    "history": {}
  }
}
```

- 正式 key 為 `starcare-hollow:town:v1`；同一瀏覽器、同一網站來源才會共用該存檔。
- 每次覆寫前把上一份原始內容保存至 `starcare-hollow:town:backup`，包含無法解析的資料，供日後復原或 migration 使用。
- 每次資料結構不相容時提高 `SAVE_SCHEMA_VERSION`。
- 保留逐版 migration，例如 `1 → 2`、`2 → 3`，不可只支援最新格式。
- `0.3.0` 的 schema v2 新增永久收藏與每日獎勵累計；讀取 v1 時會保留原進度，並依既有成就補發收藏。
- `0.4.0` 的 schema v3 新增搭檔技能累計；讀取 v1、v2 時預設為 0，既有資源、建築與收藏不變。
- `0.5.0` 的 schema v4 將班次成果轉為小遊戲完成數與配對組數；舊有服務紀錄仍保留，新增欄位以 0 安全補齊。
- `0.6.0` 的 schema v5 新增 `expedition` 地圖快照與遠征累計；讀取 v1～v4 時以固定 seed 補新地圖，不變動既有資源、建築或收藏。
- 寫入前先複製舊資料；遷移失敗時保留原檔並讓玩家重新嘗試。
- 不把存檔、遙測或個人資料提交到 repository。

## 5. 靜態網站限制

- 所有站內素材使用 `./` 相對路徑；不可使用 `/assets/...` 根路徑。
- GitHub Pages 大小寫敏感，檔名與引用必須完全一致。
- 前端程式不可包含 API key 或其他秘密；GitHub Pages 交付給瀏覽器的內容都是公開的。
- 若未來需要帳號、雲端存檔、多人或安全交易，另建後端服務，前端只呼叫受保護的 API。
- 大型圖像使用 WebP／AVIF，音訊使用 OGG／AAC，並保留載入失敗的替代畫面。

## 6. 建議里程碑

| 版本 | 重點 | 升級護欄 |
|---|---|---|
| 0.1.x | 灰盒手感與難度調整 | 已封存，不新增永久存檔 |
| 0.2.x | 小鎮核心、本機存檔、星願手札、分岔／解謎／遠征／換裝切片 | 共用存檔已建立；逐項小版驗證，不平行量產 |
| 0.3.x | 永久收藏基礎、遠征收藏、角色關係與完整衣櫥 | 固定地圖種子；持續 schema migration 與保底測試 |
| 0.4.x | 可愛居民調度、主動搭檔技能與技能收藏 | 舊存檔遷移、觸控捲動與跨系統回歸 |
| 0.5.x | 三種配對小遊戲、主動技能與封閉測試 | 共用規則核心、舊存檔遷移、資料最小化 |
| 0.6.x | Canvas 星脈遠征、逐格挖寶與遺物收藏 | 固定 seed、規則／繪圖分離、DPR 與手勢隔離驗收 |
| 1.0.0 | 正式公開版 | 完整回歸與存檔復原演練 |

星脈遠征的完整來源研究、玩法規則與分期驗收見 [《Treasure Isle》研究與「星脈遠征」擴充設計](10_TREASURE_ISLE_RESEARCH_AND_EXPANSION.md)。
好友訪談衍生的共同主系統、分岔存檔、解謎護眼與換裝規格見 [好友遊戲偏好轉譯與整合系統規格](11_FRIEND_PLAYSTYLE_SYSTEM_SPEC.md)。

## 7. 發布完成條件

- GitHub Actions 的 `Validate prototype` 與 `Deploy production site` 均成功。
- 公開網址能載入，且瀏覽器主控台沒有 error。
- 至少完成翻牌、雙雙消除、三件收納各一輪，施放一次搭檔技能，並測試暫停／恢復與重試。
- 桌面及手機沒有文件層級橫向捲動。
- 舊存檔可載入；若資料毀損，能安全回到新存檔且不阻止遊戲啟動。
