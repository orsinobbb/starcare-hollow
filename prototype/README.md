# 《星癒小鎮》可玩灰盒原型

這個原型驗證「上層診所經營壓力」與「下層連線盤決策」能否形成同一個循環。它不需要安裝任何第三方套件。

## 啟動

在本資料夾執行：

```powershell
npm start
```

然後開啟 <http://127.0.0.1:4173>。

模擬 GitHub Pages 的儲存庫子路徑：

```powershell
npm run start:pages
```

開啟 <http://127.0.0.1:4173/starcare-hollow/>。

## 操作

- 滑鼠／觸控：按住並拖過相鄰的相同符號，放開完成。
- 點選模式：右上角開啟後，逐顆點選，再按「完成連線」。
- 鍵盤：方向鍵移動、空白鍵加入路徑、Enter 完成、Escape 取消或暫停。
- 5、7、10、13 顆長鏈依序生成脈衝珠、共鳴珠、星核、完美星核。

## 驗證

```powershell
npm run check
```

網址參數可縮短測試，例如 `?duration=30&goal=2&seed=test&debug=1`。正式預設仍是 180 秒、目標 5 人。

公開版由 `main` 分支自動發布至 <https://orsinobbb.github.io/starcare-hollow/>。版本升級、存檔相容與回復方式見 [GitHub 發布與長期升級規格](../docs/09_GITHUB_RELEASE_UPGRADE.md)。
