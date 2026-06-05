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
      <div class="player-item">
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

function setStatus(text) {
  document.getElementById('statusBar').textContent = text;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}