// ============================================================
// database.js — BuzzerBeater 球员数据库 (IndexedDB + SQLite导出)
// ============================================================
// 重构要点：
// 1. 新增 _meta objectStore 缓存 total/latestScrape，
//    getStats 不再遍历全表
// 2. savePlayers/importPlayers 改为先批量 get 现有记录，
//    再批量 put，减少微任务调度
// 3. getPlayersByIds 改为并行请求
//
// sql-asm.js 由 background.js 顶层 importScripts 加载，
// 这里只缓存 initSqlJs() 的初始化结果。
// ============================================================

let _sqlPromise = null;

async function loadSqlJs() {
  if (_sqlPromise) return _sqlPromise;
  if (typeof initSqlJs === 'undefined') {
    throw new Error('sql.js 未加载，请确保background.js顶层importScripts了sql-asm.js');
  }
  _sqlPromise = initSqlJs();
  return _sqlPromise;
}

class PlayerDatabase {
  constructor() {
    this.dbName = 'buzzerbeaterDB';
    this.dbVersion = 2; // 升级：新增 _meta objectStore
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

        // players objectStore（与 v1 一致，保留 id 作为 keyPath）
        if (!db.objectStoreNames.contains('players')) {
          const store = db.createObjectStore('players', { keyPath: 'id' });
          store.createIndex('scrapedAt', 'scrapedAt', { unique: false });
          store.createIndex('position', 'position', { unique: false });
        }

        // _meta objectStore：存 total / latestScrape 等汇总数据
        // keyPath: 'key', value: 'value'
        if (!db.objectStoreNames.contains('_meta')) {
          db.createObjectStore('_meta', { keyPath: 'key' });
        }
      };
    });
  }

  async ready() {
    await this.dbReady;
  }

  // ─── 内部工具：事务内批量 get ──────────────────────────────
  // 单事务内发起 N 个并行 get 请求，所有结果统一返回
  _batchGet(store, ids) {
    return new Promise((resolve, reject) => {
      if (!ids || ids.length === 0) return resolve([]);
      const results = [];
      let pending = ids.length;
      let errored = false;

      ids.forEach(id => {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) results.push(req.result);
          if (--pending === 0 && !errored) resolve(results);
        };
        req.onerror = () => {
          if (--pending === 0 && !errored) resolve(results);
        };
      });
    });
  }

  // ─── 内部工具：事务内批量 put ──────────────────────────────
  _batchPut(store, records) {
    return new Promise((resolve, reject) => {
      const transaction = store.transaction;
      if (!records || records.length === 0) {
        transaction.oncomplete = () => resolve();
        return;
      }
      let pending = records.length;
      records.forEach(r => {
        const req = store.put(r);
        req.onsuccess = () => {
          if (--pending === 0) { /* 等 transaction.oncomplete */ }
        };
        req.onerror = () => {
          if (--pending === 0) { /* 等 transaction.oncomplete */ }
        };
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  // ─── 内部工具：meta 读写 ──────────────────────────────────
  async _getMeta(keys) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['_meta'], 'readonly');
      const store = transaction.objectStore('_meta');
      const result = {};
      let pending = keys.length;
      if (pending === 0) return resolve({});

      keys.forEach(k => {
        const req = store.get(k);
        req.onsuccess = () => {
          result[k] = req.result ? req.result.value : null;
          if (--pending === 0) resolve(result);
        };
        req.onerror = () => {
          if (--pending === 0) resolve(result);
        };
      });
    });
  }

  async _setMeta(key, value) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['_meta'], 'readwrite');
      const store = transaction.objectStore('_meta');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async _setMetaBatch(entries) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['_meta'], 'readwrite');
      const store = transaction.objectStore('_meta');
      entries.forEach(([key, value]) => store.put({ key, value }));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // ─── 内部工具：写入后全量刷新 meta ──────────────────────────
  // 直接重算 total 而非用 delta 累加，避免增量更新逻辑出错
  async _refreshMetaAfterWrite() {
    const players = await this.getAllPlayers();
    let latestScrape = null;
    if (players.length > 0) {
      let maxTime = 0;
      for (const p of players) {
        const t = p.scrapedAt ? new Date(p.scrapedAt).getTime() : 0;
        if (t > maxTime) {
          maxTime = t;
          latestScrape = p.scrapedAt;
        }
      }
    }
    await this._setMetaBatch([
      ['total', players.length],
      ['latestScrape', latestScrape]
    ]);
  }

  // 内部工具：保留旧 API 以防外部调用
  async _updateMetaFromPuts(putList, options = {}) {
    if (!putList || putList.length === 0) return;
    await this._refreshMetaAfterWrite();
  }

  // ─── 公开 API ────────────────────────────────────────────

  // 保存球员数据（30天去重）
  async savePlayers(players) {
    await this.ready();
    if (!players || players.length === 0) return { saved: 0, skipped: 0 };

    const now = new Date();
    const validPlayers = players.filter(p => p.id && p.name);
    if (validPlayers.length === 0) return { saved: 0, skipped: 0 };

    // 批量读取现有记录
    const ids = validPlayers.map(p => p.id);
    const existing = await this.getPlayersByIds(ids);
    const existingMap = new Map(existing.map(p => [p.id, p]));

    let saved = 0;
    let skipped = 0;
    const toPut = [];

    for (const p of validPlayers) {
      const record = existingMap.get(p.id);
      if (record && record.scrapedAt) {
        const lastScraped = new Date(record.scrapedAt);
        const diffDays = (now - lastScraped) / (1000 * 60 * 60 * 24);
        if (diffDays < 30) {
          skipped++;
          continue;
        }
      }
      toPut.push({ ...p, scrapedAt: now.toISOString() });
      saved++;
    }

    if (toPut.length > 0) {
      const transaction = this.db.transaction(['players'], 'readwrite');
      const store = transaction.objectStore('players');
      await this._batchPut(store, toPut);
      await this._updateMetaFromPuts(toPut, { byPosition: false });
    }

    return { saved, skipped };
  }

  // 查询所有球员
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

  // 按ID批量查询球员（并行请求）
  async getPlayersByIds(ids) {
    await this.ready();
    if (!ids || ids.length === 0) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['players'], 'readonly');
      const store = transaction.objectStore('players');
      this._batchGet(store, ids).then(resolve).catch(reject);
    });
  }

  // 统计信息（走 _meta，不再遍历全表）
  // 自愈：_meta 未初始化时（如从 v1 升级或首次打开插件），
  // 回退到 getAllPlayers() 计算并回写 _meta，一次性完成修复
  async getStats() {
    await this.ready();
    const meta = await this._getMeta(['total', 'latestScrape']);

    if (meta.total === null || meta.total === undefined) {
      // _meta 缺失，回退到全量统计并回写
      const players = await this.getAllPlayers();
      let latestScrape = null;
      if (players.length > 0) {
        const sorted = [...players].sort((a, b) =>
          new Date(b.scrapedAt || 0) - new Date(a.scrapedAt || 0)
        );
        latestScrape = sorted[0]?.scrapedAt || null;
      }
      // 回写 _meta，后续走快路径
      await this._setMetaBatch([
        ['total', players.length],
        ['latestScrape', latestScrape]
      ]);
      return {
        total: players.length,
        latestScrape
      };
    }

    return {
      total: meta.total || 0,
      latestScrape: meta.latestScrape || null
    };
  }

  // ─── 导出 ────────────────────────────────────────────────

  async exportData() {
    const players = await this.getAllPlayers();
    return {
      players,
      exportedAt: new Date().toISOString(),
      count: players.length
    };
  }

  async exportAsSQLite() {
    const players = await this.getAllPlayers();
    const SQL = await loadSqlJs();
    const db = new SQL.Database();

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
      const transaction = this.db.transaction(
        ['players', '_meta'], 'readwrite'
      );
      transaction.objectStore('players').clear();
      transaction.objectStore('_meta').clear();

      transaction.oncomplete = () => resolve({ cleared: true });
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // ─── 导入球员数据（JSON数组）───────────────────────────────
  async importPlayers(players) {
    await this.ready();
    if (!players || players.length === 0) return { saved: 0, skipped: 0 };

    const now = new Date();
    const validPlayers = players.filter(p => p.id && p.name);
    if (validPlayers.length === 0) return { saved: 0, skipped: 0 };

    const ids = validPlayers.map(p => p.id);
    const existing = await this.getPlayersByIds(ids);
    const existingMap = new Map(existing.map(p => [p.id, p]));

    let saved = 0;
    let skipped = 0;
    const toPut = [];

    for (const p of validPlayers) {
      const record = existingMap.get(p.id);
      if (record && record.scrapedAt) {
        const existingTime = new Date(record.scrapedAt);
        const importTime = p.scrapedAt ? new Date(p.scrapedAt) : new Date(0);
        const diffDays = (now - existingTime) / (1000 * 60 * 60 * 24);
        if (diffDays < 30 && importTime <= existingTime) {
          skipped++;
          continue;
        }
      }
      toPut.push({
        ...p,
        scrapedAt: p.scrapedAt || now.toISOString()
      });
      saved++;
    }

    if (toPut.length > 0) {
      const transaction = this.db.transaction(['players'], 'readwrite');
      const store = transaction.objectStore('players');
      await this._batchPut(store, toPut);
      await this._updateMetaFromPuts(toPut, { byPosition: false });
    }

    return { saved, skipped };
  }

  // ─── 从SQLite导入数据 ───────────────────────────────────────
  async importFromSQLite(dataArray) {
    const SQL = await loadSqlJs();
    const buffer = new Uint8Array(dataArray);
    const sqlDb = new SQL.Database(buffer);

    const results = sqlDb.exec('SELECT * FROM players');
    if (results.length === 0 || results[0].values.length === 0) {
      sqlDb.close();
      return { saved: 0, skipped: 0, count: 0 };
    }

    const columns = results[0].columns;
    const players = results[0].values.map(row => {
      const obj = {};
      columns.forEach((col, idx) => {
        let val = row[idx];
        // SQLite 导出列名为 scraped_at，转回 scrapedAt
        if (col === 'scraped_at') col = 'scrapedAt';
        obj[col] = val;
      });
      return obj;
    });

    sqlDb.close();

    const result = await this.importPlayers(players);
    return { ...result, count: players.length };
  }
}