# 星癒小鎮（Starcare Hollow）

[![Quality and deploy GitHub Pages](https://github.com/orsinobbb/starcare-hollow/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/orsinobbb/starcare-hollow/actions/workflows/deploy-pages.yml)

這個資料夾包含完整遊戲設計、美術生成提示，以及一個可直接遊玩的瀏覽器灰盒原型。

公開遊玩網址：<https://orsinobbb.github.io/starcare-hollow/>

## 直接遊玩

```powershell
cd prototype
npm start
```

開啟 <http://127.0.0.1:4173>。不需要安裝第三方套件；玩法與測試方式見 [原型說明](prototype/README.md)。

## 從這裡開始

1. 先玩一輪 [瀏覽器灰盒](prototype/README.md)，確認診所壓力與連線手感。
2. 閱讀 [設計總覽](docs/00_PROJECT_OVERVIEW.md) 與 [核心玩法](docs/01_CORE_GAMEPLAY.md)。
3. 把 [美術需求](docs/06_ART_DIRECTION_AI_ASSET_BRIEFS.md) 的 A01～A08 提示交給繪圖 AI。
4. 將原尺寸 PNG 放回專案，再進行風格、可讀性與製作可行性審查。
5. 依 [製作與驗證計畫](docs/08_PRODUCTION_VALIDATION.md) 收集首輪玩家數據並調整平衡。

## 文件

- [產品總覽](docs/00_PROJECT_OVERVIEW.md)
- [核心診療玩法](docs/01_CORE_GAMEPLAY.md)
- [經營與長期進度](docs/02_META_PROGRESSION.md)
- [世界、角色與關卡內容](docs/03_CONTENT_NARRATIVE.md)
- [UX、UI 與無障礙](docs/04_UX_UI_ACCESSIBILITY.md)
- [經濟、公式與難度](docs/05_ECONOMY_BALANCE.md)
- [美術方向與 AI 圖像清單](docs/06_ART_DIRECTION_AI_ASSET_BRIEFS.md)
- [音樂與聲音規格](docs/07_AUDIO_DIRECTION.md)
- [製作、技術與驗證](docs/08_PRODUCTION_VALIDATION.md)
- [GitHub 發布與長期升級](docs/09_GITHUB_RELEASE_UPGRADE.md)

## 可匯入表格

- [第一章關卡表](docs/data/mvp_level_plan.csv)
- [首批圖片清單](docs/data/art_first_batch_manifest.csv)
- [平衡種子參數](docs/data/balance_seed.csv)
- [各階段內容規模](docs/data/content_scope.csv)
