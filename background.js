// ============================================================
// background.js — BuzzerBeater 数据采集器 Service Worker
// ============================================================

importScripts('sql-asm.js', 'database.js');

// ─── 初始化数据库 ────────────────────────────────────────────
const db = new PlayerDatabase();

// ─── 消息处理 ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(result => sendResponse({ success: true, ...result }))
    .catch(err => {
      console.error('[BG] 消息处理出错:', err);
      sendResponse({ success: false, error: err.message });
    });

  return true; // 保持消息通道开放（异步响应）
});

async function handleMessage(message) {
  switch (message.action) {
    case 'savePlayers':
      return await handleSavePlayers(message.players);

    case 'getPlayers':
      return await handleGetPlayers();

    case 'getStats':
      return await handleGetStats();

    case 'exportData':
      return await handleExportData();

    case 'exportSQLite':
      return await handleExportSQLite();

    case 'importPlayers':
      return await handleImportPlayers(message.players);

    case 'importSQLite':
      return await handleImportSQLite(message.data);

    case 'getPlayersByIds':
      return await handleGetPlayersByIds(message.ids);

    case 'clearAll':
      return await handleClearAll();

    default:
      return { error: '未知操作' };
  }
}

async function handleSavePlayers(players) {
  return await db.savePlayers(players);
}

async function handleGetPlayers() {
  const players = await db.getAllPlayers();
  return { players };
}

async function handleGetStats() {
  const stats = await db.getStats();
  return { stats };
}

async function handleExportData() {
  const data = await db.exportData();
  return { data, size: JSON.stringify(data).length };
}

async function handleExportSQLite() {
  return await db.exportAsSQLite();
}

async function handleClearAll() {
  return await db.clearAll();
}

async function handleImportPlayers(players) {
  return await db.importPlayers(players);
}

async function handleImportSQLite(dataArray) {
  return await db.importFromSQLite(dataArray);
}

async function handleGetPlayersByIds(ids) {
  const players = await db.getPlayersByIds(ids);
  return { players };
}