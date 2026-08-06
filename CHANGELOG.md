# BuzzerBeater Scraper Extension - 更新日志

## Ver 1.2.0 (2026-08-06)

### 新增功能
- **面板注入逻辑优化**：页面内本地数据面板现在严格按"页面未提取到 → 查询本地 → 注入"流程执行
  - 页面已展示技能数据的球员不重复显示本地面板
  - 仅对页面缺失技能数据的球员（属性私有）显示本地记录面板

### 问题修复
- **私有属性球员面板显示**：修复属性私有的球员页面内无任何数据提示的问题
  - 球员详情页 (`extractPlayerOverview`) 和球队列表 (`extractTeamPlayers`) 在技能字段全为 0 时不再入库，避免污染数据库
  - 但已入库的历史记录（即使技能全为 0）仍会在面板中显示抓取时间，文案改为"技能数据未采集"
- **属性未公开时不保存占位数据**：球员详情页检测到 `hasSkills=false` 时跳过本次入库，由本地面板接管展示
- **meta 统计自愈**：`getStats` 在 `_meta` 缺失时回退到全量统计并回写
- **批量 I/O 优化**：`savePlayers` / `importPlayers` / `getPlayersByIds` 改为单事务内并行请求，减少微任务调度
- **回退惰性加载 sql.js**：恢复 `background.js` 顶层 `importScripts('sql-asm.js', 'database.js')`，修复 SQLite 导出时"message port closed"错误
- **`importFromSQLite` 返回 `count` 字段**：弹窗可正确显示导入文件中的记录总数

### 修改文件
| 文件 | 改动内容 |
|------|----------|
| `manifest.json` | 版本号 1.0.0 → 1.2.0 |
| `content.js` | 提取函数返回 `{id, data, box}` 三元组；`extractData` 计算 `missingBoxes`；新增 `extractIdFromContainer`；面板注入仅针对未采集球员 |
| `database.js` | `_meta` 缓存；`_refreshMetaAfterWrite` 全量重算；批量 `_batchGet`/`_batchPut`；`importFromSQLite` 返回 `count` |
| `background.js` | 顶层 `importScripts` |

---

## Ver 1.1 (2026-06-05)

### 新增功能
- **技能数据展示**：在弹窗面板中显示球员技能数据
  - 显示格式：`跳投:XX 范围:XX 外防:XX 控球:XX 突破:XX 传球:XX 内投:XX 内防:XX 篮板:XX 盖帽:XX`
  - 值为0的技能不显示
  - 技能之间以单个空格分隔
- **数据导入功能**：支持导入 JSON 和 SQLite 文件
  - 用于重装系统或更换浏览器后恢复数据
  - 遵循30天去重逻辑，避免重复导入
- **页面内本地数据展示**：在球员详情和球队球员列表页面，采集完成后会在每个球员容器右下角注入一个浮动面板
  - 显示本地数据库中已存储的技能数据
  - 红色边框、半透明深色背景，与原页面样式明显区分
  - 仅在本地有数据时显示，避免干扰

### 问题修复
- **排序逻辑修正**：球员列表现在按采集时间降序排列（最新采集的排最前）
- **技能提取修复**：修复转会市场技能值≥20时无法采集的bug（正则表达式优化）

### UI优化
- **面板布局重构**：采用两行横向排列
  - 第一行：球员名 + 位置标签 + 国籍标签（左）| 年龄 / 薪金（右）
  - 第二行：ID（左）| 技能数据（右）
- **弹窗宽度调整**：420px → 480px，适配技能数据显示

### 修改文件
| 文件 | 改动内容 |
|------|----------|
| `popup.js` | 排序逻辑、布局模板重构、技能字段映射与渲染、导入功能 |
| `popup.html` | CSS布局样式调整、弹窗宽度480px、新增 `.player-row` / `.player-skills` 样式、导入按钮 |
| `content.js` | 页面内数据面板注入函数、技能提取正则修复 |
| `background.js` | 新增 `importPlayers`、`importSQLite`、`getPlayersByIds` 消息处理 |
| `database.js` | 新增 `importPlayers`、`importFromSQLite`、`getPlayersByIds` 方法 |

---

## Ver 1.0 (初始版本)

- 球员数据采集（转会市场、球员详情、球队球员列表）
- IndexedDB 本地存储
- 30天去重逻辑
- JSON / SQLite 导出功能
- 弹窗面板显示最近采集的球员（20条）