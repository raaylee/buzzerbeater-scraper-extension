// ============================================================
// content.js — BuzzerBeater 球员数据提取脚本
// 支持3种页面：转会市场、球员详情、球队球员列表
// ============================================================

(function () {
  'use strict';

  // 页面类型检测
  const url = window.location.href;
  let pageType = 'unknown';
  if (url.includes('/manage/transferlist.aspx')) {
    pageType = 'transferlist';
  } else if (url.match(/\/player\/\d+\/overview\.aspx/)) {
    pageType = 'playerOverview';
  } else if (url.match(/\/team\/\d+\/players\.aspx/)) {
    pageType = 'teamPlayers';
  }

  console.log(`[BB Scraper] 检测到页面类型: ${pageType}`);

  // ─── 技能名称映射 (中文 → 英文键名) ─────────────────────────
  const SKILL_MAP = {
    '跳投能力': 'jump_shot',
    '投篮范围': 'jump_range',
    '外线防守': 'perim_def',
    '控球能力': 'handling',
    '运球能力': 'driving',
    '传球能力': 'passing',
    '内线投篮': 'inside_shot',
    '内线防守': 'inside_def',
    '篮板能力': 'rebound',
    '盖帽能力': 'shot_block',
    '体能耐力': 'stamina',
    '罚球能力': 'free_throw'
  };

  // ─── 技能等级 → 数值映射 ───────────────────────────────────
  const SKILL_LEVEL_MAP = {
    'terrible': 1, 'awful': 2, 'poor': 4, 'mediocre': 7, 'average': 10,
    'decent': 12, 'respectable': 13, 'good': 15, 'very good': 17, 'great': 18,
    'excellent': 20, 'outstanding': 22, 'superb': 23, 'spectacular': 24,
    'sensational': 26, 'marvelous': 28, 'magnificent': 29, 'extraordinary': 30,
    'unique': 32, 'super human': 34, 'legendary': 36,
    // 中文等级
    '极差': 1, '很差': 2, '较差': 4, '一般': 7, '普通': 10,
    '尚可': 12, '不错': 13, '好': 15, '很好': 17, '非常好': 18,
    '优秀': 20, '杰出': 22, '出色': 24, '惊艳': 26, '惊人': 28,
    '非凡': 30, '独特': 32, '超人类': 34, '传奇': 36
  };

  // ─── 从文本解析技能值 ──────────────────────────────────��───
  function parseSkillValue(text) {
    if (!text) return 0;
    // 匹配格式: "stupendous (17)" 或 "(17)"
    const match = text.match(/\((\d+)\)/);
    if (match) return parseInt(match[1]);
    
    // 尝试匹配等级文字
    const lower = text.toLowerCase().trim();
    for (const [level, value] of Object.entries(SKILL_LEVEL_MAP)) {
      if (lower.includes(level)) return value;
    }
    return 0;
  }

  // ─── 提取数字（去除逗号空格） ───────────────────────────────
  function parseNumber(text) {
    if (!text) return 0;
    return parseInt(text.replace(/[^0-9]/g, '')) || 0;
  }

  // ─── 从文本中提取字段 ───────────────────────────────────────
  function extractFromText(text) {
    const data = {};
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    
    // 查找名字+ID的模式：可能在第一行或第二行
    // 格式1: "Juán Bridges (50314988)" - 详情页
    // 格式2: "Raimon Surroca (53920654)" - 转会市场（第二行）
    let nameIdMatch = null;
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      const match = lines[i].match(/^([^(]+)\s*\((\d+)\)/);
      if (match) {
        nameIdMatch = match;
        break;
      }
    }
    
    if (nameIdMatch) {
      data.name = nameIdMatch[1].trim();
      data.id = parseInt(nameIdMatch[2]);
    }
    
    // 位置：可能在第一行 "小前锋 (SF)" / "控球后卫 (PG)" 
    // 或第二行 "控球后卫 (PG)"，需要扫描前几行
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      const posMatch = lines[i].match(/\(([A-Z]{1,2})\)/);
      if (posMatch && lines[i].includes('(' + posMatch[1] + ')')) {
        // 排除数字格式如 (123)
        data.position = posMatch[1];
        break;
      }
    }
    
    // 薪金：从 "薪金： $ 97 217"
    const salaryMatch = text.match(/薪金[：:]\s*\$\s*([\d\s,]+)/);
    if (salaryMatch) {
      data.salary = parseNumber(salaryMatch[1]);
    }
    
    // 年龄：从 "年龄： 34"
    const ageMatch = text.match(/年龄[：:]\s*(\d+)/);
    if (ageMatch) {
      data.age = parseInt(ageMatch[1]);
    }
    
    // 身高：从 "身高： 6'3\" / 190 cm"
    const heightMatch = text.match(/身高[：:]\s*([\d'"\s]+\/\s*[\d]+\s*cm)/);
    if (heightMatch) {
      data.height = heightMatch[1].trim();
    }
    
    // 潜力：从 "潜力： superstar (8)"
    const potMatch = text.match(/潜力[：:]\s*([\w\u4e00-\u9fa5]+)/);
    if (potMatch) {
      data.potential = potMatch[1].trim();
    }
    
    // 技能提取
    for (const [cnName, enName] of Object.entries(SKILL_MAP)) {
      // 匹配格式：技能名: 等级 (数值) 或 技能名: 等级(数值)
      // 优先匹配括号中的数字，更可靠
      const skillMatch = text.match(new RegExp(cnName + '[：:]\\s*.*?\\((\\d+)\\)'));
      if (skillMatch) {
        data[enName] = parseInt(skillMatch[1]);
      }
    }
    
    return data;
  }

  // ─── 球员详情页面 ───────────────────────────────────────────
  function extractPlayerOverview() {
    const entries = [];

    try {
      const playerBox = document.getElementById('playerbox');
      if (!playerBox) {
        console.log('[BB Scraper] 未找到 #playerbox');
        return entries;
      }

      // 获取playerbox内的所有文本
      const boxText = playerBox.innerText;

      // 解析基础数据
      const data = extractFromText(boxText);

      // 提取国籍：从国旗图片的title属性
      const flagImg = playerBox.querySelector('img[title][src*="flags"]');
      if (flagImg && flagImg.title) {
        data.nationality = flagImg.title;
      }

      // 如果没有从文本解析到ID，尝试从URL获取
      if (!data.id) {
        const idMatch = url.match(/\/player\/(\d+)\//);
        data.id = idMatch ? parseInt(idMatch[1]) : null;
      }

      if (!data.id || !data.name) {
        console.log('[BB Scraper] 无法解析球员信息');
        return entries;
      }

      // 确保所有技能字段存在
      const allSkills = ['jump_shot', 'jump_range', 'perim_def', 'handling',
                         'driving', 'passing', 'inside_shot', 'inside_def',
                         'rebound', 'shot_block'];
      allSkills.forEach(skill => {
        if (data[skill] === undefined) data[skill] = 0;
      });

      entries.push({ id: data.id, data, box: playerBox });
      console.log('[BB Scraper] 提取到球员:', data.name, data.id);

    } catch (err) {
      console.error('[BB Scraper] 解析球员详情出错:', err);
    }

    return entries;
  }

  // ─── 转会市场页面 ───────────────────────────────────────────
  function extractTransferList() {
    const entries = [];

    try {
      // 查找所有球员容器
      const playerBoxes = document.querySelectorAll('#playerbox, .widebox, .oldbox');
      console.log(`[BB Scraper] 找到 ${playerBoxes.length} 个球员容器`);

      playerBoxes.forEach(box => {
        // 只处理转会市场页面的球员box（不是详情页的单个playerbox）
        if (box.id === 'playerbox' && playerBoxes.length === 1) {
          return; // 这是详情页，不处理
        }

        const boxText = box.innerText;
        const data = extractFromText(boxText);

        // 提取国籍
        const flagImg = box.querySelector('img[title][src*="flags"]');
        if (flagImg && flagImg.title) {
          data.nationality = flagImg.title;
        }

        if (data.id && data.name) {
          // 补充缺失字段
          const allSkills = ['jump_shot', 'jump_range', 'perim_def', 'handling',
                             'driving', 'passing', 'inside_shot', 'inside_def',
                             'rebound', 'shot_block'];
          allSkills.forEach(skill => {
            if (data[skill] === undefined) data[skill] = 0;
          });
          entries.push({ id: data.id, data, box });
        }
      });

    } catch (err) {
      console.error('[BB Scraper] 解析转会市场出错:', err);
    }

    return entries;
  }

  // ─── 球队球员列表页面 ───────────────────────────────────────
  function extractTeamPlayers() {
    const entries = [];

    try {
      const playerBoxes = document.querySelectorAll('.widebox, .oldbox, #playerbox');

      playerBoxes.forEach(box => {
        const boxText = box.innerText;
        const data = extractFromText(boxText);

        // 提取国籍
        const flagImg = box.querySelector('img[title][src*="flags"]');
        if (flagImg && flagImg.title) {
          data.nationality = flagImg.title;
        }

        if (data.id && data.name) {
          const allSkills = ['jump_shot', 'jump_range', 'perim_def', 'handling',
                             'driving', 'passing', 'inside_shot', 'inside_def',
                             'rebound', 'shot_block'];
          allSkills.forEach(skill => {
            if (data[skill] === undefined) data[skill] = 0;
          });

          // 检查技能是否全部为0（非本球队的未出售球员技能不可见）
          const hasSkills = allSkills.some(skill => data[skill] > 0);
          if (!hasSkills) {
            console.log(`[BB Scraper] 跳过无技能数据的球员: ${data.name} (${data.id})`);
            return;
          }

          entries.push({ id: data.id, data, box });
        }
      });

    } catch (err) {
      console.error('[BB Scraper] 解析球队页面出错:', err);
    }

    return entries;
  }

  // ─── 主提取函数 ──────────────────────────────────────────────
  function extractData() {
    let entries = [];

    switch (pageType) {
      case 'playerOverview':
        entries = extractPlayerOverview();
        break;
      case 'transferlist':
        entries = extractTransferList();
        break;
      case 'teamPlayers':
        entries = extractTeamPlayers();
        break;
      default:
        console.log('[BB Scraper] 未知页面类型');
        return;
    }

    console.log(`[BB Scraper] 提取到 ${entries.length} 名球员`, entries);

    // 调试：打印页面内容
    if (entries.length === 0) {
      const boxes = document.querySelectorAll('.widebox, .oldbox, #playerbox');
      console.log(`[BB Scraper] 找到 ${boxes.length} 个球员容器`);
      if (boxes.length > 0) {
        console.log('[BB Scraper] 第一个容器内容:', boxes[0].innerText.substring(0, 500));
      }
    }

    // 找出"页面有 box 但本次未提取到数据"的容器
    // （如球队页面里没技能数据的球员、本队对手的外援等）
    const extractedIds = new Set(entries.map(e => e.id));
    const allBoxes = document.querySelectorAll('.widebox, .oldbox, #playerbox');
    const missingBoxes = [];
    allBoxes.forEach(box => {
      // 跳过已经注入过面板的容器
      if (box.querySelector('.bbs-local-data-panel')) return;
      const id = extractIdFromContainer(box);
      if (id && !extractedIds.has(id)) {
        missingBoxes.push({ id, box });
      }
    });

    // 只在球员详情/球队页面注入本地面板
    if (pageType === 'playerOverview' || pageType === 'teamPlayers') {
      injectLocalDataPanels(missingBoxes);
    }

    // 保存已提取到的球员（fire-and-forget，不阻塞提取/注入）
    if (entries.length > 0) {
      const players = entries.map(e => e.data);
      chrome.runtime.sendMessage(
        { action: 'savePlayers', players },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[BB Scraper] 发送消息失败:', chrome.runtime.lastError.message);
            return;
          }
          if (response && response.success) {
            console.log(`[BB Scraper] 保存成功: ${response.saved} 新增, ${response.skipped} 跳过`);
          }
        }
      );
    }
  }

  // ─── 从容器中提取球员ID（仅扫描前几行）────────────────────
  function extractIdFromContainer(box) {
    const text = box.innerText || '';
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      const match = lines[i].match(/\((\d{6,})\)/);
      if (match) return parseInt(match[1]);
    }
    return null;
  }

  // ─── 创建数据展示面板DOM ──────────────────────────────────
  function createDataPanel(player) {
    const panel = document.createElement('div');
    panel.className = 'bbs-local-data-panel';
    panel.setAttribute('data-bbs-player-id', player.id);

    const skillKeys = [
      ['jump_shot', '跳投'],
      ['jump_range', '范围'],
      ['perim_def', '外防'],
      ['handling', '控球'],
      ['driving', '突破'],
      ['passing', '传球'],
      ['inside_shot', '内投'],
      ['inside_def', '内防'],
      ['rebound', '篮板'],
      ['shot_block', '盖帽']
    ];

    const skillParts = skillKeys
      .map(([key, label]) => {
        const v = player[key];
        return (v !== undefined && v !== null && v !== 0) ? `${label}:${v}` : null;
      })
      .filter(Boolean);

    const skillText = skillParts.join(' ');
    const scrapedDate = player.scrapedAt
      ? new Date(player.scrapedAt).toLocaleDateString('zh-CN')
      : '';

    panel.innerHTML = `
      <div class="bbs-panel-header">📊 本地数据${scrapedDate ? ' (' + scrapedDate + ')' : ''}</div>
      ${skillText ? `<div class="bbs-panel-skills">${escapeHtml(skillText)}</div>` : '<div class="bbs-panel-empty">无技能数据</div>'}
    `;
    return panel;
  }

  // ─── HTML转义（供面板使用） ───────────────────────────────
  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── 在页面内注入本地数据面板 ─────────────────────────────
  // 只对页面"未提取到数据"的球员容器注入本地面板：
  // - 入参 entries 是 extractData() 中"未成功提取"的球员容器列表
  // - 页面已展示的球员不重复显示本地数据
  // - 避免对无关 box 调用 extractIdFromContainer（由 extractData 预处理）
  function injectLocalDataPanels(entries) {
    if (!entries || entries.length === 0) return;

    const ids = entries.map(e => e.id);
    chrome.runtime.sendMessage(
      { action: 'getPlayersByIds', ids },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.success) return;
        const players = response.players || [];
        if (players.length === 0) return;

        const playerMap = new Map(players.map(p => [p.id, p]));
        let injected = 0;

        entries.forEach(({ id, box }) => {
          // 防止重试期间 box 已被其他路径注入过
          if (box.querySelector('.bbs-local-data-panel')) return;

          const player = playerMap.get(id);
          if (!player) return;

          // 直接设 inline 样式，省去 getComputedStyle 触发的 layout
          box.style.position = 'relative';

          const panel = createDataPanel(player);
          box.appendChild(panel);
          injected++;
        });

        if (injected > 0) {
          console.log(`[BB Scraper] 已在 ${injected} 个无数据球员容器内注入本地数据面板`);
        }
      }
    );
  }

  // ─── 注入面板所需样式（仅注入一次）───────────────────────
  function injectPanelStyles() {
    if (document.getElementById('bbs-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'bbs-panel-styles';
    style.textContent = `
      .bbs-local-data-panel {
        position: absolute;
        right: 8px;
        bottom: 8px;
        max-width: 60%;
        background: rgba(26, 26, 46, 0.92);
        color: #e0e0e0;
        border: 1px solid #e94560;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 11px;
        line-height: 1.4;
        z-index: 9999;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        pointer-events: none;
      }
      .bbs-panel-header {
        font-weight: 600;
        color: #e94560;
        margin-bottom: 3px;
        font-size: 10px;
      }
      .bbs-panel-skills {
        color: #a0a0b0;
        white-space: normal;
        word-break: break-all;
      }
      .bbs-panel-empty {
        color: #666;
        font-style: italic;
      }
    `;
    document.head.appendChild(style);
  }

  // ─── 启动提取 ──────────────────────────────────────────────
  function tryExtract(attempts = 0) {
    injectPanelStyles();
    extractData();

    // 如果是转会市场，再尝试几次（数据可能是动态加载的）
    if (pageType === 'transferlist' && attempts < 3) {
      setTimeout(() => tryExtract(attempts + 1), 2000);
    }
  }

  if (document.readyState === 'complete') {
    setTimeout(tryExtract, 1500);
  } else {
    window.addEventListener('load', () => {
      setTimeout(tryExtract, 1500);
    });
  }
})();