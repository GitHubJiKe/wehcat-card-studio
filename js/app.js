/* ==========================================================
   贴图工坊 · 主逻辑
   纯本地运行：图片经 FileReader 转 dataURL，数据存 localStorage，
   导出用本地 html2canvas，全程不发任何网络请求。
   ========================================================== */
(function () {
  'use strict';

  const { TEMPLATES, hexToRgba, esc } = window.WX;
  const WXAI = window.WX_AI;
  const LS_KEY = 'wx-card-studio-v1';
  const CARD_W = 1080;
  const CARD_H = 1440;
  const TOTAL = 20;
  const CANON_COUNT = 6; // 6 张时的完整角色表
  const AI_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
  const AI_DEFAULT_MODEL = 'deepseek-flash';
  const TITLE_SIZE_RANGE = [72, 160];
  const BODY_SIZE_RANGE = [32, 72];
  const TITLE_SIZE_DEFAULT = 112;
  const BODY_SIZE_DEFAULT = 48;

  // 6 张卡的叙事角色：封面钩子 → 承接 → 展开 → 转折 → 收尾
  const ROLES = [
    { label: '封面 · 钩子', kicker: '开篇', hint: '一句话勾住注意力，让人想往下看' },
    { label: '承接 · 铺垫', kicker: '接着说', hint: '接住封面，把背景或问题讲清楚' },
    { label: '展开 · 要点一', kicker: '要点 01', hint: '抛出第一个核心观点' },
    { label: '展开 · 要点二', kicker: '要点 02', hint: '第二个观点，或情绪的推进' },
    { label: '转折 · 深化', kicker: '关键', hint: '反转或更进一步，制造记忆点' },
    { label: '收尾 · 行动号召', kicker: '最后', hint: '总结全文，引导点赞在看关注' },
  ];

  const EMOJIS = [
    '😀', '😂', '🥰', '😎', '🤔', '😅', '😭', '🥳',
    '🤯', '🫣', '😏', '😡', '👍', '👎', '👏', '🙏',
    '💪', '✌️', '🤝', '🫶', '❤️', '💔', '💯', '⭐',
    '✨', '🔥', '💡', '📌', '🎯', '🚀', '🎉', '🏆',
    '💰', '📈', '📉', '⏰', '✅', '❌', '❗', '❓',
    '👀', '👉', '👇', '📝', '📖', '🎓', '☕', '🍜',
  ];

  // ---------- 工具 ----------
  const $ = (id) => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function readFileAsDataURL(file, cb) {
    const r = new FileReader();
    r.onload = () => cb(r.result);
    r.readAsDataURL(file);
  }

  // ---------- 数据 ----------
  function blankCards() {
    return Array.from({ length: TOTAL }, () => ({ kicker: '', title: '', body: '', stickers: [], bgImage: null, bgDim: 0.25 }));
  }

  function seedCards() {
    const seeds = [
      { title: '你的贴图，为什么没人看完？', body: '大部分人翻到第 2 张就划走了。\n接下来 6 张图，我把「让人一张张看下去」的排版心得拆给你看，看完就能用。', stickers: [{ id: uid(), type: 'emoji', char: '🔥', x: 85, y: 9, size: 150 }] },
      { title: '先说结论：钩子决定生死', body: '封面不是封面，是承诺。\n读者只给你 0.8 秒，一句话讲清「看完我能得到什么」，比任何精美配图都管用。', stickers: [] },
      { title: '一张图，只讲一件事', body: '贪心是排版的大忌。\n每张图只放一个观点，正文控制在 60 字以内，剩下的留给下一张。', stickers: [] },
      { title: '节奏感，比文笔更重要', body: '钩子 → 承接 → 展开 → 转折 → 收尾。\n信息像下台阶一样层层递进，读者滑起来毫不费力。', stickers: [{ id: uid(), type: 'emoji', char: '💡', x: 85, y: 10, size: 130 }] },
      { title: '第 5 张，放最狠的干货', body: '注意力在这里到达顶点。\n把压箱底的清单、数字、反常识结论放在这张，截图率最高。', stickers: [] },
      { title: '现在，轮到你了', body: '打开编辑器，套上今天的模板，做你的第一组 6 图。\n如果这篇对你有用：\n点赞 👍  在看 👀  转发 🔁', stickers: [{ id: uid(), type: 'emoji', char: '🎉', x: 50, y: 84, size: 130 }] },
    ];
    const cards = blankCards();
    seeds.forEach((seed, i) => {
      Object.assign(cards[i], seed, { kicker: '' });
    });
    return cards;
  }

  function defaultState() {
    return {
      template: 'minimal',
      accent: null,
      avatar: null,
      footer: '@我的公众号 · 未经授权请勿转载',
      format: 'png',
      count: 6,
      bgImage: null,
      bgDim: 0.25,
      titleSize: TITLE_SIZE_DEFAULT,
      bodySize: BODY_SIZE_DEFAULT,
      post: { title: '', summary: '', tags: [] },
      ai: { apiKey: '', model: AI_DEFAULT_MODEL, thinking: false },
      cards: seedCards(),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.cards) || s.cards.length !== TOTAL || !s.template) return null;
      // 已下线的旧模板（gradient/neon）迁移到杂志白并重置强调色，内容保留
      if (!TEMPLATES[s.template]) { s.template = 'minimal'; s.accent = null; }
      return s;
    } catch (e) { return null; }
  }

  let saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 400); }

  function saveState() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (err) {
      // 图片太大超配额：降级为只存文字与贴纸位置
      try {
      const slim = JSON.parse(JSON.stringify(state));
      slim.avatar = null;
      slim.bgImage = null;
      slim.cards.forEach((c) => {
          if (c.bgImage) c.bgImage = null;
          c.stickers = c.stickers.filter((s) => s.type === 'emoji');
        });
        localStorage.setItem(LS_KEY, JSON.stringify(slim));
        toast('内容已保存（图片较大，刷新后需重新上传图片）');
      } catch (e2) { /* 忽略 */ }
    }
  }

  const state = loadState() || defaultState();
  if (!state.ai) state.ai = { apiKey: '', model: AI_DEFAULT_MODEL, thinking: false };
  if (!Number.isInteger(state.count) || state.count < 1 || state.count > TOTAL) state.count = TOTAL;
  if (!Number.isInteger(state.titleSize)) state.titleSize = TITLE_SIZE_DEFAULT;
  state.titleSize = clamp(state.titleSize, TITLE_SIZE_RANGE[0], TITLE_SIZE_RANGE[1]);
  if (!Number.isInteger(state.bodySize)) state.bodySize = BODY_SIZE_DEFAULT;
  state.bodySize = clamp(state.bodySize, BODY_SIZE_RANGE[0], BODY_SIZE_RANGE[1]);
  if (typeof state.bgImage !== 'string' && state.bgImage !== null) state.bgImage = null;
  if (typeof state.bgDim !== 'number' || Number.isNaN(state.bgDim)) state.bgDim = 0.25;
  if (!state.post || typeof state.post !== 'object') state.post = { title: '', summary: '', tags: [] };
  if (!Array.isArray(state.post.tags)) state.post.tags = [];
  let drawerIndex = 0;      // 抽屉正在编辑第几张
  let drawerOpen = false;
  let selectedStickerId = null; // 选中的贴纸 id
  let exporting = false;
  let scaleRO = null;

  const currentAccent = () => state.accent || TEMPLATES[state.template].defaultAccent;

  // ---------- 品牌字体（fonts/ 目录，免费商用） ----------
  // 标题：中华薪火体（铅印宋，新华社×蓝色共鸣）；正文：演示秋鸿楷（楷书，Keynote 研究所）
  const BRAND_FONTS = [
    { family: 'XinHuo', file: 'fonts/SinoTorch.ttf?v=1' },
    { family: 'QiuHong', file: 'fonts/Slideqiuhong.ttf?v=1' },
  ];

  function loadBrandFonts() {
    BRAND_FONTS.forEach((f) => {
      const face = new FontFace(f.family, `url("${f.file}")`, { display: 'swap' });
      face.load().then((loaded) => document.fonts.add(loaded))
        .catch((err) => console.warn('品牌字体加载失败，已回退系统字体：' + f.family, err));
    });
  }

  // 当前张数下第 i 张的叙事角色：首张封面、末张收尾、中间为展开要点；6 张时用完整角色表
  function roleAt(i) {
    const n = state.count;
    if (n === CANON_COUNT) return ROLES[i];
    if (n === 1) return { label: '单张 · 钩子', kicker: '看点', hint: '一张图讲清一件事，勾住注意力' };
    if (i === 0) return ROLES[0];
    if (i === n - 1) return ROLES[ROLES.length - 1];
    return { label: '展开 · 第 ' + i + ' 点', kicker: '要点 ' + String(i).padStart(2, '0'), hint: '核心观点或信息推进，一张图一件事' };
  }

  // ---------- 头像 ----------
  function renderAvatarUI() {
    const has = !!state.avatar;
    avatarThumb.style.backgroundImage = has ? "url('" + state.avatar + "')" : '';
    avatarBtnText.textContent = has ? '更换' : '上传';
    avatarClear.hidden = !has;
  }

  function applyAvatar(src) {
    state.avatar = src || null;
    renderAvatarUI();
    renderGrid();
    scheduleSave();
  }

  // ---------- 全局背景图（顶栏上传，所有卡片生效；单卡可单独覆盖） ----------
  function anyCardBg() {
    return state.cards.some((c) => c.bgImage);
  }

  function renderBgUI() {
    const has = !!state.bgImage;
    const any = has || anyCardBg();
    gbThumb.style.backgroundImage = has ? "url('" + state.bgImage + "')" : '';
    gbBtnText.textContent = has ? '更换' : '上传';
    gbClear.hidden = !any;
    gbDimRow.hidden = !has;
    gbDimRange.value = state.bgDim;
  }

  function applyGlobalBg(src) {
    state.bgImage = src || null;
    renderBgUI();
    renderGrid();
    scheduleSave();
  }

  // ---------- DOM 引用 ----------
  const grid = $('cardGrid');
  const drawer = $('drawer');
  const drawerTitle = $('drawerTitle');
  const drawerRole = $('drawerRole');
  const fKicker = $('fKicker');
  const fTitle = $('fTitle');
  const fBody = $('fBody');
  const emojiGrid = $('emojiGrid');
  const stickerFiles = $('stickerFiles');
  const stickerPanel = $('stickerPanel');
  const selPreview = $('selPreview');
  const stickerSize = $('stickerSize');
  const bgFile = $('bgFile');
  const dimRow = $('dimRow');
  const bgDim = $('bgDim');
  const templateTabs = $('templateTabs');
  const accentGroup = $('accentGroup');
  const accentSwatches = $('accentSwatches');
  const footerInput = $('footerInput');
  const avatarThumb = $('avatarThumb');
  const avatarBtnText = $('avatarBtnText');
  const avatarClear = $('avatarClear');
  const avatarFile = $('avatarFile');
  const gbThumb = $('gbThumb');
  const gbBtnText = $('gbBtnText');
  const gbClear = $('gbClear');
  const gbFile = $('gbFile');
  const gbDimRange = $('gbDimRange');
  const formatSeg = $('formatSeg');
  const exportAllBtn = $('exportAllBtn');
  const countVal = $('countVal');
  const titleSizeVal = $('titleSizeVal');
  const bodySizeVal = $('bodySizeVal');
  const aiOpenBtn = $('aiOpenBtn');
  const pubOpenBtn = $('pubOpenBtn');
  const pubModal = $('pubModal');
  const postTitle = $('postTitle');
  const postSummary = $('postSummary');
  const postTags = $('postTags');
  const titleCount = $('titleCount');
  const summaryCount = $('summaryCount');
  const tagsPreview = $('tagsPreview');
  const aiModal = $('aiModal');
  const aiSource = $('aiSource');
  const aiHint = $('aiHint');
  const aiKey = $('aiKey');
  const aiModel = $('aiModel');
  const aiThinking = $('aiThinking');
  const aiCount = $('aiCount');
  const aiSubCount = $('aiSubCount');
  const aiRunBtn = $('aiRunBtn');
  const aiStatus = $('aiStatus');
  const aiJson = $('aiJson');
  const aiImportBtn = $('aiImportBtn');
  const aiJsonFile = $('aiJsonFile');
  const aiCopySpecBtn = $('aiCopySpecBtn');
  const aiCopyJsonBtn = $('aiCopyJsonBtn');
  const aiApplyBtn = $('aiApplyBtn');
  const stage = $('exportStage');
  const toastEl = $('toast');

  function updateExportBtn() {
    exportAllBtn.textContent = '⬇ 一键导出 ' + state.count + ' 张';
  }

  // ---------- 渲染 ----------
  function stickerHTML(s) {
    const selCls = s.id === selectedStickerId ? ' selected' : '';
    if (s.type === 'emoji') {
      return `<div class="sticker s-emoji${selCls}" data-id="${s.id}" style="left:${s.x}%;top:${s.y}%;font-size:${s.size}px">${esc(s.char)}</div>`;
    }
    return `<div class="sticker s-img${selCls}" data-id="${s.id}" style="left:${s.x}%;top:${s.y}%;width:${s.size}px"><img src="${s.src}" alt=""></div>`;
  }

  function cardInner(i, card) {
    const t = TEMPLATES[state.template];
    const indexStr = String(i + 1).padStart(2, '0');
    const countStr = String(state.count).padStart(2, '0');
    let html = '';
    const bg = card.bgImage || state.bgImage;
    const dim = card.bgImage ? (card.bgDim || 0) : (state.bgImage ? (state.bgDim || 0) : 0);
    if (bg) {
      html += `<div class="bg-layer" style="background-image:url('${bg}')"></div>`;
      html += `<div class="bg-dim" style="background:rgba(0,0,0,${dim})"></div>`;
    }
    html += `<div class="card-content">${t.content(card, { num: i + 1, indexStr, role: roleAt(i), accent: currentAccent() })}</div>`;
    html += `<div class="sticker-layer">${card.stickers.map(stickerHTML).join('')}</div>`;
    if (state.avatar) html += `<div class="card-avatar" style="background-image:url('${state.avatar}')"></div>`;
    html += `<div class="card-index">${indexStr} / ${countStr}</div>`;
    html += `<div class="card-footer">${esc(state.footer)}</div>`;
    return html;
  }

  function buildCard(i) {
    const card = state.cards[i];
    const t = TEMPLATES[state.template];
    const selected = currentAccent(); // 浅色模板=强调色；深色封面模板=背景色
    const accent = t.shades ? t.pop : selected; // 卡片内的点缀色
    const el = document.createElement('article');
    el.className = 'wx-card t-' + state.template;
    el.style.background = card.bgImage ? '#1c1c1e' : t.cardBg(i, selected);
    el.style.setProperty('--accent', accent);
    el.style.setProperty('--accent-ghost', t.shades ? 'rgba(255,255,255,.09)' : hexToRgba(selected, 0.12));
    el.style.setProperty('--accent-glow', hexToRgba(accent, 0.3));
    el.style.setProperty('--title-size', state.titleSize + 'px');
    el.style.setProperty('--body-size', state.bodySize + 'px');
    el.innerHTML = cardInner(i, card);
    return el;
  }

  function buildCell(i) {
    const cell = document.createElement('div');
    cell.className = 'cell' + (drawerOpen && i === drawerIndex ? ' editing' : '');
    cell.dataset.index = i;
    cell.innerHTML = `
      <div class="cell-head">
        <div class="cell-tag">第 ${i + 1} 张 · ${roleAt(i).label}</div>
        <div class="cell-actions">
          <button class="mini" data-act="edit" type="button">编辑</button>
          <button class="mini" data-act="export" type="button">导出此图</button>
        </div>
      </div>
      <div class="card-shell"><div class="card-scale"></div></div>`;
    cell.querySelector('.card-scale').appendChild(buildCard(i));
    return cell;
  }

  function renderGrid() {
    if (scaleRO) scaleRO.disconnect();
    grid.innerHTML = '';
    for (let i = 0; i < state.count; i++) grid.appendChild(buildCell(i));
    // 预览缩放：卡片固定 1080×1440，按外壳宽度等比缩小
    scaleRO = new ResizeObserver((entries) => {
      for (const en of entries) {
        const sc = en.target.querySelector('.card-scale');
        if (sc) sc.style.transform = 'scale(' + (en.contentRect.width / CARD_W) + ')';
      }
    });
    grid.querySelectorAll('.card-shell').forEach((sh) => scaleRO.observe(sh));
    checkOverflow();
  }

  function renderCard(i) {
    const cell = grid.querySelector(`.cell[data-index="${i}"]`);
    if (!cell) return;
    const old = cell.querySelector('.wx-card');
    if (old) old.replaceWith(buildCard(i));
    checkOverflow();
  }

  // 字号放大后内容可能超出画面，检测并提示（以第 1 张为准）
  let overflowWarnedAt = 0;
  function checkOverflow() {
    const cell = grid.querySelector('.cell');
    if (!cell) return;
    const card = cell.querySelector('.wx-card');
    const body = card && card.querySelector('[class$="-body"]');
    if (!card || !body) return;
    const scale = card.getBoundingClientRect().width / CARD_W;
    if (!scale) return;
    const bottom = (body.getBoundingClientRect().bottom - card.getBoundingClientRect().top) / scale;
    const now = Date.now();
    if (bottom > CARD_H - 150 && now - overflowWarnedAt > 4000) {
      overflowWarnedAt = now;
      toast('提示：当前字号下内容超出了画面底部，建议减小字号或精简文字');
    }
  }

  function renderToolbar() {
    templateTabs.innerHTML = Object.keys(TEMPLATES).map((k) => {
      const t = TEMPLATES[k];
      return `<button class="tab ${k === state.template ? 'active' : ''}" data-tpl="${k}" type="button">
        <i class="dot" style="background:linear-gradient(135deg,${t.swatch[0]},${t.swatch[1]})"></i>${t.name}</button>`;
    }).join('');
    const t = TEMPLATES[state.template];
    const swatchList = t.shades || t.accents || null;
    accentGroup.style.display = swatchList ? '' : 'none';
    accentLabel.textContent = t.shades ? '背景色' : '强调色';
    accentSwatches.innerHTML = (swatchList || []).map((c) => {
      const hex = typeof c === 'string' ? c : c.hex;
      const label = typeof c === 'string' ? '' : c.label;
      return `<button class="swatch ${hex === currentAccent() ? 'active' : ''}" data-color="${hex}" title="${label}" style="background:${hex}" type="button"></button>`;
    }).join('');
    footerInput.value = state.footer;
    formatSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.fmt === state.format));
  }

  // ---------- 编辑抽屉 ----------
  function openDrawer(i) {
    drawerIndex = i;
    drawerOpen = true;
    selectedStickerId = null;
    document.body.classList.add('drawer-open');
    grid.querySelectorAll('.cell').forEach((c, k) => c.classList.toggle('editing', k === i));
    populateDrawer();
    drawer.classList.add('open');
  }

  function closeDrawer() {
    drawerOpen = false;
    document.body.classList.remove('drawer-open');
    drawer.classList.remove('open');
    grid.querySelectorAll('.cell').forEach((c) => c.classList.remove('editing'));
  }

  function populateDrawer() {
    const card = state.cards[drawerIndex];
    const role = roleAt(drawerIndex);
    drawerTitle.textContent = '第 ' + (drawerIndex + 1) + ' 张';
    drawerRole.textContent = role.label + ' · ' + role.hint;
    fKicker.value = card.kicker;
    fTitle.value = card.title;
    fBody.value = card.body;
    dimRow.hidden = !card.bgImage;
    bgDim.value = card.bgDim || 0;
    renderStickerPanel();
  }

  function renderStickerPanel() {
    const card = state.cards[drawerIndex];
    const s = card.stickers.find((x) => x.id === selectedStickerId);
    if (!s) { stickerPanel.hidden = true; return; }
    stickerPanel.hidden = false;
    if (s.type === 'emoji') {
      selPreview.innerHTML = '<span style="font-size:32px">' + esc(s.char) + '</span>';
      stickerSize.min = 60; stickerSize.max = 460;
    } else {
      selPreview.innerHTML = '<img src="' + s.src + '">';
      stickerSize.min = 80; stickerSize.max = 980;
    }
    stickerSize.value = s.size;
  }

  function deleteSelectedSticker() {
    const card = state.cards[drawerIndex];
    card.stickers = card.stickers.filter((s) => s.id !== selectedStickerId);
    selectedStickerId = null;
    renderCard(drawerIndex);
    renderStickerPanel();
    scheduleSave();
  }

  function addSticker(s) {
    state.cards[drawerIndex].stickers.push(s);
    selectedStickerId = s.id;
    renderCard(drawerIndex);
    renderStickerPanel();
    scheduleSave();
  }

  // ---------- 导出 ----------
  function fileName(i) {
    return `贴图_${TEMPLATES[state.template].name}_${String(i + 1).padStart(2, '0')}.${state.format}`;
  }

  function download(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // 克隆卡片到屏外舞台，按 1080×1440 原尺寸截图（预览缩放不影响导出）
  async function captureCard(i) {
    const cell = grid.querySelector(`.cell[data-index="${i}"]`);
    const article = cell && cell.querySelector('.wx-card');
    if (!article) throw new Error('找不到第 ' + (i + 1) + ' 张卡片');
    const clone = article.cloneNode(true);
    clone.querySelectorAll('.sticker.selected').forEach((el) => el.classList.remove('selected'));
    stage.appendChild(clone);
    try {
      await document.fonts.ready; // 确保品牌字体已就绪再截图
      return await html2canvas(clone, {
        scale: 1,
        width: CARD_W,
        height: CARD_H,
        backgroundColor: state.format === 'jpg' ? '#ffffff' : null,
        logging: false,
        useCORS: true,
      });
    } finally {
      clone.remove();
    }
  }

  async function exportOne(i) {
    if (exporting) { toast('正在导出，请稍候…'); return; }
    if (typeof html2canvas === 'undefined') { toast('未找到 html2canvas，请检查 vendor 目录'); return; }
    exporting = true;
    try {
      const canvas = await captureCard(i);
      download(canvas.toDataURL(state.format === 'jpg' ? 'image/jpeg' : 'image/png', 0.92), fileName(i));
      toast('第 ' + (i + 1) + ' 张已导出 ✓');
    } catch (err) {
      console.error(err);
      toast('导出失败：' + (err && err.message ? err.message : err));
    } finally {
      exporting = false;
    }
  }

  async function exportAll() {
    if (exporting) return;
    if (typeof html2canvas === 'undefined') { toast('未找到 html2canvas，请检查 vendor 目录'); return; }
    exporting = true;
    exportAllBtn.disabled = true;
    exportAllBtn.textContent = '导出中…';
    try {
      for (let i = 0; i < state.count; i++) {
        const canvas = await captureCard(i);
        download(canvas.toDataURL(state.format === 'jpg' ? 'image/jpeg' : 'image/png', 0.92), fileName(i));
        await sleep(450); // 间隔触发，避免浏览器拦截连续下载
      }
      toast(state.count + ' 张贴图已全部导出 ✓（首次会询问“允许下载多个文件”，请允许）');
    } catch (err) {
      console.error(err);
      toast('导出失败：' + (err && err.message ? err.message : err));
    } finally {
      exporting = false;
      exportAllBtn.disabled = false;
      updateExportBtn();
    }
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  // ---------- AI 生成 / JSON 导入 ----------
  function setAIStatus(type, msg) {
    if (!type) { aiStatus.hidden = true; aiStatus.className = 'ai-status'; return; }
    aiStatus.hidden = false;
    aiStatus.className = 'ai-status ' + type;
    aiStatus.textContent = msg;
  }

  function openAIModal() {
    // 兼容旧存档里的失效模型 ID（如 deepseek-chat），迁移到当前默认
    if (!AI_MODELS.includes(state.ai.model)) state.ai.model = AI_DEFAULT_MODEL;
    aiKey.value = state.ai.apiKey || '';
    aiModel.value = state.ai.model;
    aiThinking.checked = !!state.ai.thinking;
    aiCount.value = state.count;
    setAIStatus(null);
    aiModal.hidden = false;
  }

  function closeAIModal() {
    aiModal.hidden = true;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) { return false; }
    }
  }

  // 把解析后的文案对象套到卡片上：只改文字，不动贴纸和背景；
  // 页脚是用户身份设置，AI/JSON 不覆盖；张数跟随 JSON 的 cards 数量
  function applyContent(parsed) {
    if (parsed.template && TEMPLATES[parsed.template]) state.template = parsed.template;
    if (parsed.accent && /^#[0-9a-fA-F]{6}$/.test(parsed.accent)) state.accent = parsed.accent;
    if (typeof parsed.title === 'string') state.post.title = parsed.title.slice(0, 20);
    if (typeof parsed.summary === 'string') state.post.summary = parsed.summary.slice(0, 1000);
    if (Array.isArray(parsed.tags)) state.post.tags = parsed.tags.slice(0, 10);
    for (let i = 0; i < parsed.cards.length && i < TOTAL; i++) {
      const c = parsed.cards[i];
      state.cards[i].kicker = c.kicker;
      state.cards[i].title = c.title;
      state.cards[i].body = c.body;
    }
    const n = clamp(parsed.cards.length, 1, TOTAL);
    setCount(n);
    renderToolbar();
    saveState();
  }

  function currentContentJSON() {
    return JSON.stringify({
      title: state.post.title,
      summary: state.post.summary,
      tags: state.post.tags,
      template: state.template,
      accent: currentAccent(),
      footer: state.footer,
      cards: state.cards.slice(0, state.count).map((c) => ({ kicker: c.kicker, title: c.title, body: c.body })),
    }, null, 2);
  }

  async function runAI() {
    const key = aiKey.value.trim();
    const source = aiSource.value.trim();
    if (!key) { setAIStatus('err', '请先填入 DeepSeek API Key（platform.deepseek.com 申请，仅保存在本机）'); return; }
    if (!source) { setAIStatus('err', '请先在①里粘贴原始素材'); return; }

    state.ai.apiKey = key;
    state.ai.model = aiModel.value;
    state.ai.thinking = aiThinking.checked;
    scheduleSave();

    aiRunBtn.disabled = true;
    setAIStatus('info', '正在调用 ' + aiModel.value + (aiThinking.checked ? '（深度思考）' : '') + ' 生成 ' + state.count + ' 张文案……深度思考模式可能需要 30~90 秒，请勿关闭窗口');
    try {
      const parsed = await WXAI.callDeepseek({
        apiKey: key,
        model: aiModel.value,
        sourceText: source,
        hint: aiHint.value,
        thinking: aiThinking.checked,
        count: state.count,
      });
      aiJson.value = JSON.stringify(parsed, null, 2);
      let okMsg = '生成成功 ✓ 请检查下方 JSON（可直接修改文字），确认后点「应用到卡片」';
      if (parsed.cards.length !== state.count) {
        okMsg = 'AI 两次输出都未符合 ' + state.count + ' 张要求，已按实际 ' + parsed.cards.length + ' 张应用；可手动修改下方 JSON 后重新应用';
      }
      setAIStatus('ok', okMsg);
    } catch (err) {
      let msg;
      if (err && err.name === 'AbortError') msg = '请求超时（3 分钟），可重试一次或关闭深度思考模式';
      else if (err && err.status === 401) msg = 'API Key 无效或已过期（401）：请到 platform.deepseek.com 检查';
      else if (err && err.status === 402) msg = '账户余额不足（402）：请到 platform.deepseek.com 充值';
      else if (err && err.status === 429) msg = '请求过于频繁（429）：稍等几秒再试';
      else if (err && err.name === 'TypeError') msg = '网络请求失败：请检查网络；若浏览器拦截了跨域请求，可改走「复制规范提示词 → 外部 AI → 导入 JSON」的离线流程';
      else msg = '生成失败：' + (err && err.message ? err.message : err);
      setAIStatus('err', msg);
    } finally {
      aiRunBtn.disabled = false;
    }
  }

  function applyJSONText() {
    let parsed;
    try {
      parsed = WXAI.extractJSON(aiJson.value);
    } catch (err) {
      setAIStatus('err', err && err.message ? err.message : String(err));
      return;
    }
    applyContent(parsed);
    closeAIModal();
    toast('已应用 ' + parsed.cards.length + ' 张文案，继续加贴纸 / 换模板即可');
  }

  aiOpenBtn.addEventListener('click', openAIModal);
  $('aiClose').addEventListener('click', closeAIModal);
  aiModal.addEventListener('click', (e) => { if (e.target === aiModal) closeAIModal(); });
  aiRunBtn.addEventListener('click', runAI);
  aiApplyBtn.addEventListener('click', applyJSONText);

  aiImportBtn.addEventListener('click', () => aiJsonFile.click());
  aiJsonFile.addEventListener('change', () => {
    const f = aiJsonFile.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      aiJson.value = String(r.result || '');
      setAIStatus('info', '已读入「' + f.name + '」，检查无误后点「应用到 ' + state.count + ' 张卡片」');
    };
    r.onerror = () => setAIStatus('err', '文件读取失败');
    r.readAsText(f, 'utf-8');
    aiJsonFile.value = '';
  });

  aiCopySpecBtn.addEventListener('click', async () => {
    const ok = await copyText(WXAI.SPEC_TEXT);
    toast(ok ? '规范提示词已复制，粘贴给任意 AI（DeepSeek / Kimi / ZCode…）即可按规范生成 JSON' : '复制失败，请手动打开 SPEC.md 复制');
  });

  aiCopyJsonBtn.addEventListener('click', async () => {
    const ok = await copyText(currentContentJSON());
    toast(ok ? '当前文案的 JSON 已复制' : '复制失败');
  });

  // ---------- 张数步进（1~6）：顶栏与 AI 弹窗共用一个状态 ----------
  function setCount(n) {
    state.count = clamp(n, 1, TOTAL);
    countVal.textContent = state.count;
    aiCount.value = state.count;
    aiApplyBtn.textContent = '✓ 应用到 ' + state.count + ' 张卡片';
    aiRunBtn.textContent = '🤖 调用 DeepSeek 生成 ' + state.count + ' 张文案';
    aiSubCount.textContent = state.count;
    if (drawerOpen && drawerIndex >= state.count) closeDrawer();
    else if (drawerOpen) populateDrawer(); // 角色标签随张数变化
    renderGrid();
    updateExportBtn();
    scheduleSave();
  }

  $('countMinus').addEventListener('click', () => setCount(state.count - 1));
  $('countPlus').addEventListener('click', () => setCount(state.count + 1));

  // AI 弹窗里的生成张数输入框：与顶栏张数/网格实时联动
  aiCount.addEventListener('input', () => {
    const n = parseInt(aiCount.value, 10);
    if (Number.isInteger(n)) setCount(n);
  });
  aiCount.addEventListener('change', () => { aiCount.value = state.count; });

  // ---------- 字号步进（标题 / 正文） ----------
  function setSize(kind, n) {
    const range = kind === 'title' ? TITLE_SIZE_RANGE : BODY_SIZE_RANGE;
    const val = clamp(n, range[0], range[1]);
    state[kind + 'Size'] = val;
    $(kind + 'SizeVal').textContent = val;
    renderGrid();
    scheduleSave();
  }

  function syncSizeVals() {
    titleSizeVal.textContent = state.titleSize;
    bodySizeVal.textContent = state.bodySize;
  }

  $('titleMinus').addEventListener('click', () => setSize('title', state.titleSize - 4));
  $('titlePlus').addEventListener('click', () => setSize('title', state.titleSize + 4));
  $('bodyMinus').addEventListener('click', () => setSize('body', state.bodySize - 2));
  $('bodyPlus').addEventListener('click', () => setSize('body', state.bodySize + 2));

  // ---------- 发布文案面板（标题 / 正文 / 标签） ----------
  function tagsLine() {
    return state.post.tags.map((t) => '#' + t).join(' ');
  }

  function updatePostCounters() {
    titleCount.textContent = state.post.title.length + '/20';
    summaryCount.textContent = state.post.summary.length + '/1000';
    tagsPreview.innerHTML = state.post.tags.map((t) => '<span>#' + esc(t) + '</span>').join('');
  }

  function openPubModal() {
    postTitle.value = state.post.title;
    postSummary.value = state.post.summary;
    postTags.value = state.post.tags.join(' ');
    updatePostCounters();
    pubModal.hidden = false;
  }

  function closePubModal() {
    pubModal.hidden = true;
  }

  pubOpenBtn.addEventListener('click', openPubModal);
  $('pubClose').addEventListener('click', closePubModal);
  pubModal.addEventListener('click', (e) => { if (e.target === pubModal) closePubModal(); });

  postTitle.addEventListener('input', () => {
    state.post.title = postTitle.value;
    updatePostCounters();
    scheduleSave();
  });

  postSummary.addEventListener('input', () => {
    state.post.summary = postSummary.value;
    updatePostCounters();
    scheduleSave();
  });

  postTags.addEventListener('input', () => {
    state.post.tags = WXAI.cleanTags(postTags.value);
    updatePostCounters();
    scheduleSave();
  });

  $('copyTitle').addEventListener('click', async () => {
    if (!state.post.title) { toast('标题是空的，先填一下或用 AI 生成'); return; }
    const ok = await copyText(state.post.title);
    toast(ok ? '标题已复制 ✓' : '复制失败');
  });

  $('copySummary').addEventListener('click', async () => {
    if (!state.post.summary) { toast('正文是空的，先填一下或用 AI 生成'); return; }
    const ok = await copyText(state.post.summary);
    toast(ok ? '正文已复制 ✓' : '复制失败');
  });

  $('copyTags').addEventListener('click', async () => {
    if (!state.post.tags.length) { toast('还没有标签，先填几个关键词'); return; }
    const ok = await copyText(tagsLine());
    toast(ok ? '井号标签已复制 ✓' : '复制失败');
  });

  $('copyAllBtn').addEventListener('click', async () => {
    const parts = [];
    if (state.post.title) parts.push(state.post.title);
    if (state.post.summary) parts.push(state.post.summary);
    if (state.post.tags.length) parts.push(tagsLine());
    if (!parts.length) { toast('还没有任何发布文案'); return; }
    const ok = await copyText(parts.join('\n\n'));
    toast(ok ? '标题 + 正文 + 标签已全部复制 ✓' : '复制失败');
  });

  // ---------- 事件：顶栏 ----------
  templateTabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    state.template = b.dataset.tpl;
    state.accent = null;
    selectedStickerId = null;
    renderToolbar();
    renderGrid();
    if (drawerOpen) { selectedStickerId = null; renderStickerPanel(); }
    scheduleSave();
  });

  accentSwatches.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    state.accent = b.dataset.color;
    renderToolbar();
    renderGrid();
    scheduleSave();
  });

  footerInput.addEventListener('input', () => {
    state.footer = footerInput.value;
    grid.querySelectorAll('.card-footer').forEach((el) => { el.textContent = state.footer; });
    scheduleSave();
  });

  formatSeg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fmt]');
    if (!b) return;
    state.format = b.dataset.fmt;
    renderToolbar();
    scheduleSave();
  });

  avatarFile.addEventListener('change', () => {
    const f = avatarFile.files[0];
    if (!f) return;
    readFileAsDataURL(f, (src) => {
      applyAvatar(src);
      toast('头像已应用到全部 ' + state.count + ' 张卡片');
    });
    avatarFile.value = '';
  });

  avatarClear.addEventListener('click', () => applyAvatar(null));

  gbFile.addEventListener('change', () => {
    const f = gbFile.files[0];
    if (!f) return;
    readFileAsDataURL(f, (src) => {
      state.bgImage = src;
      if (typeof state.bgDim !== 'number') state.bgDim = 0.25;
      renderBgUI();
      renderGrid();
      scheduleSave();
      toast('全局背景图已应用到所有卡片，可用“压暗”让文字更清楚');
    });
    gbFile.value = '';
  });

  gbClear.addEventListener('click', () => {
    const hadCardBgs = anyCardBg();
    applyGlobalBg(null);
    state.cards.forEach((c) => { c.bgImage = null; });
    renderGrid();
    scheduleSave();
    toast(hadCardBgs ? '已移除全部背景图（含各卡片单独设置的背景）' : '已清除全局背景图');
  });

  gbDimRange.addEventListener('input', () => {
    state.bgDim = +gbDimRange.value;
    renderGrid();
    scheduleSave();
  });

  $('seedBtn').addEventListener('click', () => {
    if (!confirm('用示例文案覆盖当前内容吗？（贴纸与背景图会一起重置）')) return;
    state.cards = seedCards();
    state.post = {
      title: '让人一张张看下去的贴图排版',
      summary: '大部分人翻到第 2 张就划走了。\n这组贴图把「让人一张张看下去」的排版心得拆开讲：钩子决定生死、一张图只讲一件事、节奏感比文笔更重要，最后记得把最狠的干货放在第 5 张。\n看完就能直接套用，去做你自己的第一组贴图吧。',
      tags: ['公众号运营', '排版干货', '自媒体'],
    };
    selectedStickerId = null;
    setCount(6);
    renderToolbar();
    saveState();
    toast('已填入示例文案，可直接一键导出试试效果');
  });

  $('clearBtn').addEventListener('click', () => {
    if (!confirm('清空全部文案、贴纸和背景图吗？（张数不变）')) return;
    state.cards = blankCards();
    state.post = { title: '', summary: '', tags: [] };
    selectedStickerId = null;
    renderGrid();
    if (drawerOpen) populateDrawer();
    saveState();
  });

  exportAllBtn.addEventListener('click', exportAll);

  // ---------- 事件：网格（点击 / 拖拽贴纸） ----------
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      const idx = +btn.closest('.cell').dataset.index;
      if (btn.dataset.act === 'edit') openDrawer(idx);
      else exportOne(idx);
      return;
    }
    if (e.target.closest('.sticker')) return; // 贴纸的选择在 pointerup 里处理
    const cell = e.target.closest('.cell');
    if (cell && e.target.closest('.card-shell')) openDrawer(+cell.dataset.index);
  });

  let drag = null;
  grid.addEventListener('pointerdown', (e) => {
    const st = e.target.closest('.sticker');
    if (!st) return;
    const cell = st.closest('.cell');
    if (!cell) return;
    const idx = +cell.dataset.index;
    const s = state.cards[idx].stickers.find((x) => x.id === st.dataset.id);
    if (!s) return;
    drag = { st, idx, s, cardEl: st.closest('.wx-card'), moved: false };
    st.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  grid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = drag.cardEl.getBoundingClientRect();
    drag.s.x = clamp(((e.clientX - r.left) / r.width) * 100, 2, 98);
    drag.s.y = clamp(((e.clientY - r.top) / r.height) * 100, 2, 98);
    drag.moved = true;
    drag.st.style.left = drag.s.x + '%';
    drag.st.style.top = drag.s.y + '%';
  });

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved) {
      scheduleSave();
    } else {
      selectedStickerId = d.s.id;
      renderCard(d.idx);
      if (drawerOpen && drawerIndex === d.idx) renderStickerPanel();
    }
  }
  grid.addEventListener('pointerup', endDrag);
  grid.addEventListener('pointercancel', endDrag);

  // ---------- 事件：抽屉 ----------
  $('drawerClose').addEventListener('click', closeDrawer);

  [fKicker, fTitle, fBody].forEach((input, k) => {
    input.addEventListener('input', () => {
      const card = state.cards[drawerIndex];
      if (k === 0) card.kicker = input.value;
      else if (k === 1) card.title = input.value;
      else card.body = input.value;
      renderCard(drawerIndex);
      scheduleSave();
    });
  });

  emojiGrid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    addSticker({ id: uid(), type: 'emoji', char: b.dataset.emoji, x: 50, y: 42, size: 150 });
  });

  stickerFiles.addEventListener('change', () => {
    Array.prototype.slice.call(stickerFiles.files).forEach((f) => {
      readFileAsDataURL(f, (src) => addSticker({ id: uid(), type: 'image', src, x: 50, y: 42, size: 320 }));
    });
    stickerFiles.value = '';
  });

  stickerSize.addEventListener('input', () => {
    const card = state.cards[drawerIndex];
    const s = card.stickers.find((x) => x.id === selectedStickerId);
    if (!s) return;
    s.size = +stickerSize.value;
    renderCard(drawerIndex);
    scheduleSave();
  });

  $('stickerTop').addEventListener('click', () => {
    const card = state.cards[drawerIndex];
    const idx = card.stickers.findIndex((x) => x.id === selectedStickerId);
    if (idx < 0) return;
    card.stickers.push(card.stickers.splice(idx, 1)[0]);
    renderCard(drawerIndex);
    scheduleSave();
  });

  $('stickerDelete').addEventListener('click', deleteSelectedSticker);

  bgFile.addEventListener('change', () => {
    const f = bgFile.files[0];
    if (!f) return;
    readFileAsDataURL(f, (src) => {
      const card = state.cards[drawerIndex];
      card.bgImage = src;
      if (!card.bgDim) card.bgDim = 0.25;
      dimRow.hidden = false;
      bgDim.value = card.bgDim;
      renderCard(drawerIndex);
      scheduleSave();
      toast('背景图已应用，可用“压暗”让文字更清楚');
    });
    bgFile.value = '';
  });

  bgDim.addEventListener('input', () => {
    const card = state.cards[drawerIndex];
    card.bgDim = +bgDim.value;
    renderCard(drawerIndex);
    scheduleSave();
  });

  $('bgClear').addEventListener('click', () => {
    const card = state.cards[drawerIndex];
    card.bgImage = null;
    dimRow.hidden = true;
    renderCard(drawerIndex);
    scheduleSave();
  });

  // ---------- 键盘 ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!aiModal.hidden) { closeAIModal(); return; }
      if (!pubModal.hidden) { closePubModal(); return; }
      closeDrawer();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (drawerOpen && selectedStickerId) deleteSelectedSticker();
    }
  });

  // ---------- 初始化 ----------
  loadBrandFonts();
  emojiGrid.innerHTML = EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('');
  renderToolbar();
  renderAvatarUI();
  renderBgUI();
  countVal.textContent = state.count;
  aiApplyBtn.textContent = '✓ 应用到 ' + state.count + ' 张卡片';
  aiRunBtn.textContent = '🤖 调用 DeepSeek 生成 ' + state.count + ' 张文案';
  aiSubCount.textContent = state.count;
  syncSizeVals();
  updateExportBtn();
  renderGrid();

  // 调试/自动化测试钩子（不影响正常使用）
  window.__WX_DEBUG = {
    state,
    setAvatar: (url) => applyAvatar(url),
    capture: async (i) => {
      const canvas = await captureCard(clamp(i || 0, 0, TOTAL - 1));
      return canvas.toDataURL('image/png').length;
    },
    captureData: async (i) => {
      const canvas = await captureCard(clamp(i || 0, 0, TOTAL - 1));
      return canvas.toDataURL('image/png').split(',')[1];
    },
  };
})();
