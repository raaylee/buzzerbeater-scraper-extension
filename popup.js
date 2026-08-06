// ============================================================
// popup.js — BuzzerBeater 数据采集器弹出窗口逻辑
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadRecentPlayers();

  document.getElementById('btnRefresh').addEventListener('click', () => {
    loadStats();
    loadRecentPlayers();
  });

  document.getElementById('btnImport').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', handleImport);

  document.getElementById('btnExportJson').addEventListener('click', exportJson);
  document.getElementById('btnExportSqlite').addEventListener('click', exportSQLite);

  document.getElementById('btnClear').addEventListener('click', async () => {
    if (confirm('确定要清空所有球员数据吗？此操作不可撤销！')) {
      chrome.runtime.sendMessage({ action: 'clearAll' }, (response) => {
        if (response && response.success) {
          setStatus('数据已清空');
          loadStats();
          loadRecentPlayers();
        }
      });
    }
  });

  // 历史记录视图事件绑定
  document.getElementById('btnHistory').addEventListener('click', showHistoryView);
  document.getElementById('btnBack').addEventListener('click', showMainView);
  document.getElementById('btnQueryHistory').addEventListener('click', () => {
    const id = document.getElementById('historyInput').value.trim();
    if (id) loadPlayerHistory(id);
  });
  document.getElementById('historyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const id = e.target.value.trim();
      if (id) loadPlayerHistory(id);
    }
  });

  // 主列表点击球员快捷跳转历史
  document.getElementById('playerList').addEventListener('click', (e) => {
    const item = e.target.closest('.player-item');
    if (item && item.dataset.playerId) {
      showHistoryView(item.dataset.playerId);
    }
  });
});

function loadStats() {
  chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('获取统计信息失败:', chrome.runtime.lastError);
      return;
    }
    if (response && response.success) {
      const stats = response.stats;
      document.getElementById('totalCount').textContent = stats.total || 0;

      if (stats.latestScrape) {
        const d = new Date(stats.latestScrape);
        document.getElementById('lastScrape').textContent =
          `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      } else {
        document.getElementById('lastScrape').textContent = '-';
      }
    }
  });
}

function loadRecentPlayers() {
  chrome.runtime.sendMessage({ action: 'getPlayers' }, (response) => {
    const listEl = document.getElementById('playerList');

    if (chrome.runtime.lastError) {
      listEl.innerHTML = '<div class="empty-state">加载失败</div>';
      return;
    }

    if (!response || !response.success || !response.players || response.players.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="icon">📋</div>
          <div>暂无数据</div>
          <div style="font-size:11px;margin-top:4px;">访问BuzzerBeater球员页面开始采集</div>
        </div>`;
      return;
    }

    // 按采集时间降序排列（最新优先）
    const players = [...response.players]
      .sort((a, b) => new Date(b.scrapedAt) - new Date(a.scrapedAt))
      .slice(0, 20);

    // 技能字段中文映射
    const SKILL_LABELS = {
      jump_shot: '跳投',
      jump_range: '范围',
      perim_def: '外防',
      handling: '控球',
      driving: '突破',
      passing: '传球',
      inside_shot: '内投',
      inside_def: '内防',
      rebound: '篮板',
      shot_block: '盖帽'
    };

    listEl.innerHTML = players.map(p => {
      // 构建技能显示
      const skillParts = [];
      for (const [key, label] of Object.entries(SKILL_LABELS)) {
        const val = p[key];
        if (val !== undefined && val !== null && val !== 0) {
          skillParts.push(`${label}:${val}`);
        }
      }
      const skillText = skillParts.length > 0
        ? skillParts.join(' ')
        : '';

      return `
      <div class="player-item clickable-player" data-player-id="${p.id}">
        <div class="player-row">
          <div>
            <span class="player-name">${escapeHtml(p.name)}</span>
            <span class="position-tag">${escapeHtml(p.position || 'N/A')}</span>
            ${p.nationality ? `<span class="position-tag" style="background:#1a3a5c">${escapeHtml(p.nationality)}</span>` : ''}
          </div>
          <div class="player-meta">
            ${p.age ? `年龄:${p.age}` : ''}${p.salary ? `\u2003薪金:$${Number(p.salary).toLocaleString()}` : ''}
          </div>
        </div>
        <div class="player-row">
          <div class="player-id">ID: ${p.id}</div>
          ${skillText ? `<div class="player-skills">${escapeHtml(skillText)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  });
}

// 导出为JSON
function exportJson() {
  setStatus('正在导出JSON...');
  chrome.runtime.sendMessage({ action: 'exportData' }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('导出失败');
      return;
    }
    if (response && response.success) {
      const jsonStr = JSON.stringify(response.data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `buzzerbeater_players_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`JSON导出成功 (${response.size} bytes)`);
    } else {
      setStatus('导出失败');
    }
  });
}

// 导出为SQLite
function exportSQLite() {
  setStatus('正在生成SQLite数据库...');
  chrome.runtime.sendMessage({ action: 'exportSQLite' }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('导出失败: ' + chrome.runtime.lastError.message);
      return;
    }
    if (response && response.success) {
      const data = new Uint8Array(response.data);
      const blob = new Blob([data], { type: 'application/x-sqlite3' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `buzzerbeater_players_${new Date().toISOString().slice(0, 10)}.sqlite`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`SQLite导出成功 (${response.size} bytes, ${response.count}条记录)`);
    } else {
      setStatus('导出失败: ' + (response?.error || '未知错误'));
    }
  });
}

function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const fileName = file.name.toLowerCase();
  const reader = new FileReader();

  if (fileName.endsWith('.json')) {
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.players && Array.isArray(data.players)) {
          importPlayers(data.players, 'JSON');
        } else {
          setStatus('JSON格式错误');
        }
      } catch (err) {
        setStatus('JSON解析失败');
      }
    };
    reader.readAsText(file);
  } else if (fileName.endsWith('.sqlite')) {
    reader.onload = (e) => {
      const buffer = e.target.result;
      chrome.runtime.sendMessage({
        action: 'importSQLite',
        data: Array.from(new Uint8Array(buffer))
      }, (response) => {
        if (response && response.success) {
          setStatus(`SQLite导入成功 (共${response.count}条: 新增${response.saved} 跳过${response.skipped})`);
          loadStats();
          loadRecentPlayers();
        } else {
          setStatus('SQLite导入失败: ' + (response?.error || '未知错误'));
        }
      });
    };
    reader.readAsArrayBuffer(file);
  } else {
    setStatus('请选择.json或.sqlite文件');
  }

  // 清空input以便重复选择同一文件
  event.target.value = '';
}

function importPlayers(players, source) {
  chrome.runtime.sendMessage({
    action: 'importPlayers',
    players: players
  }, (response) => {
    if (response && response.success) {
      setStatus(`${source}导入成功 (新增:${response.saved} 跳过:${response.skipped})`);
      loadStats();
      loadRecentPlayers();
    } else {
      setStatus(`${source}导入失败: ` + (response?.error || '未知错误'));
    }
  });
}

function showHistoryView(preloadId) {
  document.getElementById('mainView').style.display = 'none';
  document.getElementById('historyView').style.display = 'block';
  if (preloadId) {
    document.getElementById('historyInput').value = preloadId;
    loadPlayerHistory(preloadId);
  }
}

function showMainView() {
  document.getElementById('historyView').style.display = 'none';
  document.getElementById('mainView').style.display = 'block';
  document.getElementById('historyInput').value = '';
  document.getElementById('historyCount').textContent = '';
  document.getElementById('historyList').innerHTML =
    '<div class="history-empty">输入球员 ID 或点击主列表中的球员查看历史</div>';
}

function loadPlayerHistory(id) {
  const listEl = document.getElementById('historyList');
  const countEl = document.getElementById('historyCount');
  listEl.innerHTML = '<div class="loading">查询中...</div>';
  countEl.textContent = '';

  chrome.runtime.sendMessage({ action: 'getPlayerHistory', id }, (response) => {
    if (chrome.runtime.lastError) {
      listEl.innerHTML = '<div class="history-empty">查询失败，请重试</div>';
      return;
    }

    if (response && response.success && Array.isArray(response.history) && response.history.length > 0) {
      renderHistoryList(response.history);
    } else {
      listEl.innerHTML = '<div class="history-empty">未找到该球员的历史记录</div>';
    }
  });
}

function renderHistoryList(history) {
  const listEl = document.getElementById('historyList');
  const countEl = document.getElementById('historyCount');

  const SKILL_LABELS = {
    jump_shot: '跳投',
    jump_range: '范围',
    perim_def: '外防',
    handling: '控球',
    driving: '突破',
    passing: '传球',
    inside_shot: '内投',
    inside_def: '内防',
    rebound: '篮板',
    shot_block: '盖帽'
  };

  const dates = history.map(h => {
    const d = new Date(h.scrapedAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  countEl.innerHTML = `该球员共有 <strong style="color:#e94560;">${history.length}</strong> 条历史快照<br>
  <span style="font-size:11px;color:#666;">${dates.join(' / ')}</span>`;

  listEl.innerHTML = history.map((h, index) => {
    const d = new Date(h.scrapedAt);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    const skillParts = [];
    for (const [key, label] of Object.entries(SKILL_LABELS)) {
      const val = h[key];
      if (val !== undefined && val !== null && val !== 0) {
        skillParts.push(`${label}:${val}`);
      }
    }
    const skillText = skillParts.length > 0 ? skillParts.join(' ') : '无技能数据';

    const metaParts = [];
    if (h.age) metaParts.push(`年龄:${h.age}`);
    if (h.salary) metaParts.push(`薪金:$${Number(h.salary).toLocaleString()}`);
    if (h.position) metaParts.push(`位置:${h.position}`);
    if (h.potential) metaParts.push(`潜力:${h.potential}`);
    const metaText = metaParts.join('　');

    return `<div class="history-item">
      <div class="history-date">#${index + 1}　${dateStr}</div>
      <div class="history-skills">${escapeHtml(skillText)}</div>
      ${metaText ? `<div class="history-meta">${escapeHtml(metaText)}</div>` : ''}
    </div>`;
  }).join('');
}

function setStatus(text) {
  document.getElementById('statusBar').textContent = text;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}