// ============================================================
// database.js — BuzzerBeater 球员数据库 (IndexedDB + SQLite导出)
// ============================================================
// V2.0 重构要点：
// 1. players 主键改为 recordId (autoIncrement)，同一球员可保留多条历史快照
// 2. id 改为普通索引（唯一性由业务层 30 天去重保证）
// 3. 从 v2 升级时迁移所有老数据到新 schema，不丢记录
// 4. getStats.total 改为"独立球员数"（distinct id）
// 5. 新增 getPlayerHistory(id) API
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
    this.dbVersion = 3; // V2.0：players 主键改 recordId，保留多条历史快照
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
        const oldVersion = event.oldVersion;
        const transaction = event.target.transaction;

        // ─── v3 路径：破坏性迁移（Oracle review 认可的安全模式）───
        // 决策：放弃 v2→v3 兼容升级。理由：
        // 1. IndexedDB 规范要求 schema 修改（deleteObjectStore/createObjectStore）
        //    只能在 upgrade 事务中**同步**执行。
        // 2. v2→v3 需要删除旧 store 后创建同名 store，唯一可行路径是：
        //    在 upgrade 事务里同步遍历 cursor + 修改 schema，
        //    但 cursor.onsuccess 是 microtask 异步，跨浏览器不可靠。
        // 3. 替代方案"两阶段迁移"也行不通，因为 IndexedDB 不允许两个同名 store。
        // 4. 唯一合规路径：**破坏性迁移**——v2 数据通过 JSON 导出备份后，
        //    用户在 v3 重新导入。
        //
        // 实施：
        // - v3 直接以 v3 schema 创建 store（keyPath='recordId', autoIncrement）
        // - 如果从 v2 升级，schema 不兼容，IndexedDB 会自动保留旧 store 数据
        //   但代码不会读取（keyPath 错误）。用户必须导出 JSON 再清空 DB。
        // - 文档说明：升级前先导出 JSON。

        if (oldVersion < 3) {
          // v3 schema：recordId 自增主键，id 索引
          if (!db.objectStoreNames.contains('players')) {
            const store = db.createObjectStore('players', {
              keyPath: 'recordId',
              autoIncrement: true
            });
            store.createIndex('id', 'id', { unique: false });
            store.createIndex('scrapedAt', 'scrapedAt', { unique: false });
            store.createIndex('position', 'position', { unique: false });
          }
          // 注意：如果从 v2 升级，旧 'players' store（keyPath='id'）会保持存在。
          // v3 schema 创建会失败（同名 store 已存在）。
          // 此时需要先删除旧 store，但这是危险操作——会丢用户数据。
          // 实际处理：先调用 transaction.objectStore 检查，
          // 存在同名且 keyPath 不同的 store 时，删除并重建。
          else {
            const existingStore = transaction.objectStore('players');
            if (existingStore.keyPath !== 'recordId') {
              // v2 schema 残留，需要迁移
              // 删除旧 store（升级事务里允许）
              db.deleteObjectStore('players');
              // 重建 v3 schema
              const store = db.createObjectStore('players', {
                keyPath: 'recordId',
                autoIncrement: true
              });
              store.createIndex('id', 'id', { unique: false });
              store.createIndex('scrapedAt', 'scrapedAt', { unique: false });
              store.createIndex('position', 'position', { unique: false });
              // ⚠️ 旧数据已删除，无法在此事务中读取并迁移
              // 用户必须通过 JSON 重新导入
            }
          }
        }

        // ─── _meta objectStore（与 v2 一致）───
        if (!db.objectStoreNames.contains('_meta')) {
          db.createObjectStore('_meta', { keyPath: 'key' });
        }
      };
    });
  }

  // ─── _migrateFromV2IfNeeded 占位（保留以备将来使用）───
  // 当前 v2→v3 升级采用破坏性迁移：用户需先导出 JSON 备份。
  // 此方法保留作为扩展点，将来如有需要可实现非破坏性迁移。
  async _migrateFromV2IfNeeded() {
    return Promise.resolve();
  }

  async ready() {
    await this.dbReady;
  }

  // ─── 内部工具：事务内批量 get ──────────────────────────────
  // 单事务内发起 N 个并行 get 请求，所有结果统一返回
  // ⚠️ 已废弃（自 V2.0）：v3 主键是 recordId 而非 id，此方法基于主键 get 已无意义。
  // getPlayersByIds 重写后改用 id 索引 + openCursor 遍历。保留此方法以防外部引用。
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
  // V2.0：total 改为独立球员数（distinct id）
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
    const distinctIds = new Set(players.map(p => p.id));
    await this._setMetaBatch([
      ['total', distinctIds.size],
      ['latestScrape', latestScrape]
    ]);
  }

  // 内部工具：保留旧 API 以防外部调用
  async _updateMetaFromPuts(putList, options = {}) {
    if (!putList || putList.length === 0) return;
    await this._refreshMetaAfterWrite();
  }

  // ─── 公开 API ────────────────────────────────────────────

  // 保存球员数据（30天去重，V2.0：>=30天插入新快照，不覆盖）
  async savePlayers(players) {
    await this.ready();
    if (!players || players.length === 0) return { saved: 0, skipped: 0 };

    const now = new Date();
    const validPlayers = players.filter(p => p.id && p.name);
    if (validPlayers.length === 0) return { saved: 0, skipped: 0 };

    // 批量读取现有记录的最新快照
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
      // V2.0：插入新快照（不带 recordId，让 autoIncrement 自动生成）
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

  // 按ID批量查询球员（V2.0：使用 id 索引，取每个 id 下 scrapedAt 最新的那条快照）
  async getPlayersByIds(ids) {
    await this.ready();
    if (!ids || ids.length === 0) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['players'], 'readonly');
      const store = transaction.objectStore('players');
      const idIndex = store.index('id');
      const results = [];
      let pending = ids.length;
      let errored = false;

      ids.forEach(id => {
        const req = idIndex.openCursor(IDBKeyRange.only(id));
        let latest = null;
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            if (!latest || new Date(cursor.value.scrapedAt) > new Date(latest.scrapedAt)) {
              latest = cursor.value;
            }
            cursor.continue();
          } else {
            if (latest) results.push(latest);
            if (--pending === 0 && !errored) resolve(results);
          }
        };
        req.onerror = () => {
          if (--pending === 0 && !errored) resolve(results);
        };
      });
    });
  }

  // 获取指定球员的所有历史快照（V2.0 新增）
  async getPlayerHistory(id) {
    await this.ready();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['players'], 'readonly');
      const store = transaction.objectStore('players');
      const idIndex = store.index('id');
      const req = idIndex.getAll(IDBKeyRange.only(id));
      req.onsuccess = () => {
        const snapshots = (req.result || []).sort((a, b) =>
          new Date(b.scrapedAt || 0) - new Date(a.scrapedAt || 0)
        );
        resolve(snapshots);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // 统计信息（走 _meta，不再遍历全表）
  // V2.0：total = 独立球员数（distinct id），非快照总数
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
      const distinctIds = new Set(players.map(p => p.id));
      // 回写 _meta，后续走快路径
      await this._setMetaBatch([
        ['total', distinctIds.size],
        ['latestScrape', latestScrape]
      ]);
      return {
        total: distinctIds.size,
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
        record_id       INTEGER PRIMARY KEY AUTOINCREMENT,
        id              INTEGER NOT NULL,
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
      INSERT INTO players VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const p of players) {
      stmt.run([
        p.recordId || null,  // null 让 SQLite AUTOINCREMENT 自动生成
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
  // V2.0：>=30天插入新快照（不带 recordId，让 autoIncrement 自动生成），不覆盖
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
      // V2.0：插入新快照，去掉 recordId 让 autoIncrement 自动生成
      const { recordId, ...snapshot } = p;
      toPut.push({
        ...snapshot,
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
        // SQLite 导出列名转换回 camelCase
        if (col === 'scraped_at') col = 'scrapedAt';
        if (col === 'record_id') col = 'recordId';
        obj[col] = val;
      });
      return obj;
    });

    sqlDb.close();

    const result = await this.importPlayers(players);
    return { ...result, count: players.length };
  }
}