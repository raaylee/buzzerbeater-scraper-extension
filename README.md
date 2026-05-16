# 🏀 BuzzerBeater 数据采集器 & 查看器

自动采集 BuzzerBeater 篮球经理游戏球员数据，配合桌面查看器(https://github.com/raaylee/buzzerbeater-viewer) 进行多维分析与历史追踪。

---

## 🔌 BuzzerBeater 数据采集器（Chrome 扩展）

| 项目 | 值 |
|------|-----|
| 版本 | 1.0.0 |
| Manifest | V3 |
| 支持页面 | 转会市场 · 球员详情 · 球队球员列表 |

### 功能

- **自动采集** — 页面加载后自动提取球员信息，无需手动操作
- **22 个数据字段** — ID、姓名、位置、年龄、身高、国籍、薪金、潜力、10 项技能、体能、罚球
- **30 天智能去重** — 同一球员 30 天内不重复记录
- **一键导出** — JSON / SQLite 两种格式
- **100% 隐私** — 所有数据存储在浏览器本地 IndexedDB，不上传任何服务器

### 安装

1. 打开 Chrome 浏览器，进入 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `buzzerbeater-scraper-extension` 文件夹

### 使用方法

1. 登录 [BuzzerBeater](https://www.buzzerbeater.com/)
2. 浏览转会市场、球员详情或球队球员页面，数据自动采集
3. 点击浏览器工具栏的扩展图标，查看采集统计
4. 点击"导出 JSON"或"导出 SQLite"保存数据

---

## 🖥️ BuzzerBeater 数据查看器（桌面应用）

| 项目 | 值 |
|------|-----|
| 语言 | Python 3 |
| GUI | PyQt6 ≥ 6.5.0 |
| 平台 | Windows / macOS / Linux |

### 功能

- **多格式支持** — 打开 JSON / SQLite / SQLite3 / DB 文件
- **数据合并** — 导入多个文件自动合并，同 ID 同天去重
- **多维筛选** — 年龄、薪金、潜力、10 项技能范围筛选 + 位置过滤 + 关键词搜索
- **最新记录模式** — 一键切换，只显示每个球员的最新记录
- **历史追溯** — 双击球员查看全部历史数据变化
- **数据持久化** — 保存 / 另存为 JSON 或 SQLite
- **暗色主题** — 舒适暗色界面

### 安装与运行

```bash
# 1. 安装依赖
pip install PyQt6>=6.5.0

# 2. 运行
cd buzzerbeater-viewer
python viewer.py
```

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+O | 打开文件 |
| Ctrl+S | 保存 |
| Ctrl+Shift+S | 另存为 |
| Ctrl+I | 导入合并 |
| Ctrl+Q | 退出 |

---

## 🔗 协作流程

```
BuzzerBeater 网站
    ↓ content.js 自动抓取
Chrome 扩展（IndexedDB 存储，30 天去重）
    ↓ Popup 导出 JSON / SQLite
桌面查看器（打开 / 合并 / 筛选 / 搜索 / 保存）
```

---

## 抓取的数据字段

| 类别 | 字段 | 说明 |
|------|------|------|
| **基础信息** | id, name, position, age, height, nationality, salary, potential | 球员基本资料 |
| **技能** | jump_shot, jump_range, perim_def, handling, driving, passing, inside_shot, inside_def, rebound, shot_block | 10 项篮球技能 |
| **元数据** | stamina, free_throw, scrapedAt | 体能、罚球、采集时间 |

---

## 潜力等级映射

| 文字（英文/中文） | 数值 |
|---|---|
| announcer / 播音员 | 0 |
| bench warmer / 板凳球员 | 1 |
| role player / 角色球员 | 2 |
| 6th man / 第六人 | 3 |
| starter / 主力 | 4 |
| star / 明星球员 | 5 |
| allstar / 全明星 | 6 |
| perennial allstar / 常驻全明星 | 7 |
| superstar / 超级巨星 | 8 |
| MVP / MVP | 9 |
| hall of famer / 名人堂 | 10 |
| all-time great / 历史级巨星 | 11 |
