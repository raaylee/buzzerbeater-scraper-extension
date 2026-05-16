// ============================================================
// database.js — BuzzerBeater 球员数据库 (IndexedDB + SQLite导出)
// ============================================================

class PlayerDatabase {
  constructor() {
    this.dbName = 'buzzerbeaterDB';
    this.dbVersion = 1;
    this.dbReady = this._init();
  }

  async _init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains('players')) {
          const store = db.createObjectStore('players', { keyPath: 'id' });
          store.createIndex('scrapedAt', 'scrapedAt', { unique: false });
          store.createIndex('position', 'position', { unique: false });
        }
      };
    });
  }

  async ready() {
    await this.dbReady;
  }

  // ─── 保存球员数据（含一个月去重逻辑）─────────────────��──────
  async savePlayers(players) {
    await this.ready();
    if (!players || players.length === 0) return { saved: 0, skipped: 0 };

    const now = new Date();
    let saved = 0;
    let skipped = 0;

    const transaction = this.db.transaction(['players'], 'readwrite');
    const store = transaction.objectStore('players');

    for (const p of players) {
      if (!p.id || !p.name) continue;

      // 检查一个月内是否已有该球员的记录
      const getRequest = store.get(p.id);
      
      const record = await new Promise((resolve) => {
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => resolve(null);
      });

      if (record && record.scrapedAt) {
        const lastScraped = new Date(record.scrapedAt);
        const diffMs = now - lastScraped;
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays < 30) {
          skipped++;
          continue;
        }
      }

      // 保存/更新球员数据
      store.put({
        ...p,
        scrapedAt: now.toISOString()
      });
      saved++;
    }

    return new Promise((resolve) => {
      transaction.oncomplete = () => resolve({ saved, skipped });
      transaction.onerror = () => resolve({ saved, skipped });
    });
  }

  // ─── 查询所有球员 ──────────────────────────────────────────
  async getAllPlayers() {
    await this.ready();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['players'], 'readonly');
      const store = transaction.objectStore('players');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // ─── 统计信息 ──────────────────────────────────────────────
  async getStats() {
    await this.ready();

    const allPlayers = await this.getAllPlayers();
    const byPosition = {};

    allPlayers.forEach(p => {
      const pos = p.position || 'Unknown';
      byPosition[pos] = (byPosition[pos] || 0) + 1;
    });

    let latestScrape = null;
    if (allPlayers.length > 0) {
      const sorted = [...allPlayers].sort((a, b) => 
        new Date(b.scrapedAt) - new Date(a.scrapedAt)
      );
      latestScrape = sorted[0]?.scrapedAt || null;
    }

    return {
      total: allPlayers.length,
      byPosition,
      latestScrape
    };
  }

  // ─── 导出为JSON ────────────────────────────────────────────
  async exportData() {
    const players = await this.getAllPlayers();
    return {
      players,
      exportedAt: new Date().toISOString(),
      count: players.length
    };
  }

  // ─── 导出为SQLite ──────────────────────────────────────────
  async exportAsSQLite() {
    const players = await this.getAllPlayers();
    
    // sql-asm.js 通过 initSqlJs() 初始化
    if (typeof initSqlJs === 'undefined') {
      throw new Error('sql.js 未加载，请确保background.js已加载sql-asm.js');
    }
    const SQL = await initSqlJs();
    const db = new SQL.Database();

    // 创建表
    db.run(`
      CREATE TABLE players (
        id              INTEGER PRIMARY KEY,
        name            TEXT,
        salary          INTEGER,
        age             INTEGER,
        height          TEXT,
        nationality     TEXT,
        potential       TEXT,
        position        TEXT,
        jump_shot       INTEGER,
        jump_range      INTEGER,
        perim_def       INTEGER,
        handling        INTEGER,
        driving         INTEGER,
        passing         INTEGER,
        inside_shot     INTEGER,
        inside_def      INTEGER,
        rebound         INTEGER,
        shot_block      INTEGER,
        scraped_at      TEXT
      )
    `);

    // 插入数据
    const stmt = db.prepare(`
      INSERT INTO players VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const p of players) {
      stmt.run([
        p.id || 0,
        p.name || '',
        p.salary || 0,
        p.age || 0,
        p.height || '',
        p.nationality || '',
        p.potential || '',
        p.position || '',
        p.jump_shot || 0,
        p.jump_range || 0,
        p.perim_def || 0,
        p.handling || 0,
        p.driving || 0,
        p.passing || 0,
        p.inside_shot || 0,
        p.inside_def || 0,
        p.rebound || 0,
        p.shot_block || 0,
        p.scrapedAt || ''
      ]);
    }
    stmt.free();

    // 导出数据库
    const data = db.export();
    db.close();

    return {
      data: Array.from(data),
      size: data.byteLength,
      count: players.length
    };
  }

  // ─── 清除所有数据 ──────────────────────────────────────────
  async clearAll() {
    await this.ready();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['players'], 'readwrite');
      const store = transaction.objectStore('players');
      const request = store.clear();

      request.onsuccess = () => resolve({ cleared: true });
      request.onerror = () => reject(request.error);
    });
  }
}