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

目前灰盒不保存進度。開始加入存檔時，第一份資料必須包含：

```json
{
  "schemaVersion": 1,
  "gameVersion": "0.2.0",
  "savedAt": "ISO-8601 timestamp",
  "profile": {}
}
```

- 每次資料結構不相容時提高 `SAVE_SCHEMA_VERSION`。
- 保留逐版 migration，例如 `1 → 2`、`2 → 3`，不可只支援最新格式。
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
| 0.1.x | 灰盒手感與難度調整 | 不新增永久存檔 |
| 0.2.x | 正式美術、資料驅動內容 | 鎖定素材命名與尺寸 |
| 0.3.x | 收藏、員工與本機存檔 | 啟用 schema migration |
| 0.4.x | 小鎮建造與完整章節 | 效能預算與內容驗證 |
| 0.5.x | 封閉測試與分析 | 玩家同意、資料最小化 |
| 1.0.0 | 正式公開版 | 完整回歸與存檔復原演練 |

## 7. 發布完成條件

- GitHub Actions 的 `Validate prototype` 與 `Deploy production site` 均成功。
- 公開網址能載入，且瀏覽器主控台沒有 error。
- 至少完成一條合法連線、暫停／恢復與班次重試。
- 桌面及手機沒有文件層級橫向捲動。
- 舊存檔可載入，或版本尚未提供存檔。

