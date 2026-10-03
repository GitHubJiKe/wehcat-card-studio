/* ==========================================================
   模板定义
   每个模板提供：
     name          显示名
     swatch        模板选择器上的双色样本
     accents       强调色列表（浅色模板用；与 shades 二选一）
     shades        背景色列表（深色封面模板用）：[{hex,label}]
     pop           深色模板上的点缀色（kicker / 分隔线 / 序号光晕）
     defaultAccent 默认选中色（浅色=强调色；深色=默认背景色）
     cardBg(i, c)  第 i 张（0-5）的卡片背景色，c 为当前选中色
     content(card, ctx) 卡片内容层 HTML（不含贴纸/页码/页脚，那些是公共层）
   ========================================================== */
(function (global) {
  'use strict';

  // HTML 转义（正文里的换行交给 white-space:pre-wrap 渲染）
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // #rrggbb -> rgba()，用于生成半透明装饰
  function hexToRgba(hex, a) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')';
  }

  const TEMPLATES = {

    minimal: {
      name: '杂志白',
      swatch: ['#ffffff', '#e8590c'],
      accents: ['#e8590c', '#5e1b2c', '#002fa7', '#10214d', '#27408b', '#18181b'],
      defaultAccent: '#e8590c',
      cardBg() { return '#faf9f6'; },
      content(card, ctx) {
        return `
          <div class="mn-bigindex">${ctx.indexStr}</div>
          <div class="mn-kicker">${esc(card.kicker || ctx.role.kicker)}</div>
          <h1 class="mn-title">${esc(card.title)}</h1>
          <div class="mn-rule"></div>
          <div class="mn-body">${esc(card.body)}</div>`;
      },
    },

    forest: {
      name: '墨绿',
      swatch: ['#0a4230', '#d9b36c'],
      shades: [
        { hex: '#0a4230', label: '英国赛车绿' },
        { hex: '#143126', label: '森林墨绿' },
        { hex: '#0f5132', label: '帝王绿' },
      ],
      defaultAccent: '#0a4230',
      pop: '#d9b36c', // 香槟金点缀
      cardBg(i, shade) { return shade; },
      content(card, ctx) {
        return `
          <div class="ev-bigindex">${ctx.indexStr}</div>
          <div class="ev-kicker">${esc(card.kicker || ctx.role.kicker)}</div>
          <h1 class="ev-title">${esc(card.title)}</h1>
          <div class="ev-rule"></div>
          <div class="ev-body">${esc(card.body)}</div>`;
      },
    },

    burgundy: {
      name: '勃艮第',
      swatch: ['#5e1b2c', '#d9a94e'],
      shades: [
        { hex: '#5e1b2c', label: '勃艮第红' },
        { hex: '#471019', label: '牛血红' },
        { hex: '#6e2231', label: '深酒红' },
      ],
      defaultAccent: '#5e1b2c',
      pop: '#d9a94e', // 复古金点缀
      cardBg(i, shade) { return shade; },
      content(card, ctx) {
        return `
          <div class="bu-bigindex">${ctx.indexStr}</div>
          <div class="bu-kicker">${esc(card.kicker || ctx.role.kicker)}</div>
          <h1 class="bu-title">${esc(card.title)}</h1>
          <div class="bu-rule"></div>
          <div class="bu-body">${esc(card.body)}</div>`;
      },
    },

    blue: {
      name: '靛蓝',
      swatch: ['#002fa7', '#d8c088'],
      shades: [
        { hex: '#002fa7', label: '克莱因蓝' },
        { hex: '#0a2342', label: '海军蓝' },
        { hex: '#27408b', label: '靛青' },
        { hex: '#003153', label: '普鲁士蓝' },
      ],
      defaultAccent: '#002fa7',
      pop: '#d8c088', // 雾金点缀
      cardBg(i, shade) { return shade; },
      content(card, ctx) {
        return `
          <div class="bl-bigindex">${ctx.indexStr}</div>
          <div class="bl-kicker">${esc(card.kicker || ctx.role.kicker)}</div>
          <h1 class="bl-title">${esc(card.title)}</h1>
          <div class="bl-rule"></div>
          <div class="bl-body">${esc(card.body)}</div>`;
      },
    },
  };

  global.WX = { TEMPLATES, hexToRgba, esc };
})(window);
