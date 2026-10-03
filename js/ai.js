/* ==========================================================
   AI 生成模块（纯函数，不碰 DOM）
   - SPEC_TEXT：6 图贴图文案规范（同时用作 DeepSeek 的 system
     prompt 和「复制给 AI 的规范提示词」，与 SPEC.md 保持一致）
   - callDeepseek：调用 DeepSeek /chat/completions
   - extractJSON / normalize：从 AI 返回或用户粘贴的文本中
     提取并校验文案 JSON
   ========================================================== */
(function (global) {
  'use strict';

  const SPEC_TEXT = [
    '【公众号贴图文案规范 v1.1】',
    '任务：把一段素材内容，改编成「一组贴图文案 + 发布配套文案」，输出一个 JSON 对象。',
    '张数：用户会指定 N（1~6，默认 6），cards 必须恰好 N 个对象。',
    '',
    '输出结构（严格 JSON，不要输出任何解释文字或代码块标记）：',
    '{',
    '  "title": "……",       // 必填：发布标题，不超过 20 字（公众号平台上限，不必凑满）',
    '  "summary": "……",     // 必填：发布正文，不超过 1000 字（平台上限，不必写满，建议 150~400 字，概括整组内容，口语化）',
    '  "tags": ["标签1", "标签2", "标签3"],  // 必填：3~8 个话题标签，不带井号，每个不超过 10 字',
    '  "template": "minimal | forest | burgundy | blue",  // 可选，推荐模板：minimal=杂志白 / forest=墨绿 / burgundy=勃艮第 / blue=靛蓝',
    '  "accent": "#e8590c",                        // 可选，强调色/背景色，6 位 hex',
    '  "cards": [                                  // 恰好 N 个对象，顺序即发布顺序',
    '    { "kicker": "开篇", "title": "……", "body": "……" }',
    '  ]',
    '}',
    '',
    'cards 字段说明：',
    '- kicker：小标签，不超过 6 个字，可省略（省略时用默认值）；',
    '- title：本张标题，不超过 16 个字，一张图只讲一个观点；',
    '- body：正文，40~80 字，用 \\n 表示换行，不要用 Markdown 语法；',
    '',
    'cards 的叙事结构（N 为张数）：',
    '- 第 1 张：封面钩子 —— 一句话勾住注意力，制造悬念 / 反差 / 数字，让人想往下看；',
    '- 中间各张：按逻辑递进展开核心观点，承接背景 → 要点 → 转折深化，一张图只讲一件事；',
    '- 最后 1 张：收尾号召 —— 总结全文，引导点赞、在看、转发、关注；',
    '- N=6 时的经典节奏：封面钩子 → 承接铺垫 → 要点一 → 要点二 → 转折深化（最狠干货）→ 收尾号召。',
    '',
    '写作约束：',
    '- 口语化、短句为主；',
    '- 不编造素材里没有的事实与数据；',
    '- 最后一张结尾带互动引导（如：点赞 👍 在看 👀 转发 🔁）；',
    '- title / summary / tags 与贴图内容保持一致，summary 里不要用 Markdown。',
  ].join('\n');

  function clampCount(count) {
    return Math.min(6, Math.max(1, Number(count) || 6));
  }

  function buildMessages(sourceText, hint, count) {
    const n = clampCount(count);
    const sys = SPEC_TEXT
      + '\n\n本次要求：张数 N = ' + n + '，cards 必须恰好 ' + n + ' 个对象（硬性约束，宁可精简也不要多或少）。'
      + '现在请根据用户提供的素材输出 JSON，严格只输出 JSON 本身。';
    let user = '【素材】\n' + String(sourceText || '').trim();
    if (hint && hint.trim()) user += '\n\n【补充要求】\n' + hint.trim();
    user += '\n\n【要求张数】N = ' + n;
    return [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ];
  }

  // opts: { apiKey, model, sourceText, hint, thinking }
  // 文档：https://api-docs.deepseek.com/zh-cn/api/create-chat-completion
  // 单次请求：返回模型输出的文本内容
  async function requestChat(opts, messages) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180000);
    try {
      const body = {
        model: opts.model || 'deepseek-flash',
        messages: messages,
        response_format: { type: 'json_object' },
        thinking: { type: opts.thinking ? 'enabled' : 'disabled' },
        stream: false,
      };

      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + String(opts.apiKey || '').trim(),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try {
          const j = await res.json();
          if (j && j.error && j.error.message) msg = j.error.message;
        } catch (e) { /* 保留默认消息 */ }
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      return (data
        && data.choices && data.choices[0]
        && data.choices[0].message && data.choices[0].message.content) || '';
    } finally {
      clearTimeout(timer);
    }
  }

  // 带一次自动纠偏重试：模型输出的 cards 数量与要求不符时，追加纠偏消息重试一次
  async function callDeepseek(opts) {
    const n = clampCount(opts.count);
    let raw = null;
    let result = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages = buildMessages(opts.sourceText, opts.hint, n);
      if (attempt > 0 && raw) {
        messages.push({ role: 'assistant', content: raw });
        messages.push({
          role: 'user',
          content: '你上一次输出了 ' + result.cards.length + ' 个 cards，不符合要求。请重新输出恰好 ' + n
            + ' 个 cards 的 JSON，其余字段遵守规范不变，严格只输出 JSON 本身。',
        });
      }
      raw = await requestChat(opts, messages);
      result = extractJSON(raw);
      if (result.cards.length === n) return result;
    }
    // 两次都不合规：多了截取到 N，少了按实际张数交给上层提示
    if (result.cards.length > n) result.cards = result.cards.slice(0, n);
    return result;
  }

  // 从 AI 返回 / 用户粘贴的文本中提取 JSON（容忍代码块、前后杂文字）
  function extractJSON(text) {
    let t = String(text || '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    let obj;
    try {
      obj = JSON.parse(t);
    } catch (err) {
      throw new Error('内容不是合法 JSON：请检查格式，或重新生成');
    }
    return normalize(obj);
  }

  // 校验并归一化：只保留规范字段，cards 最多取 6 个；tags 兼容字符串/数组并去掉井号
  function normalize(obj) {
    const cards = Array.isArray(obj) ? obj : obj && obj.cards;
    if (!Array.isArray(cards) || !cards.length) {
      throw new Error('JSON 中缺少 cards 数组（结构见规范）');
    }
    const out = { cards: [] };
    if (!Array.isArray(obj)) {
      if (typeof obj.template === 'string') out.template = obj.template;
      if (typeof obj.accent === 'string') out.accent = obj.accent;
      if (typeof obj.title === 'string') out.title = obj.title.trim();
      if (typeof obj.summary === 'string') out.summary = obj.summary.trim();
      if (Array.isArray(obj.tags)) out.tags = cleanTags(obj.tags.join(' '));
      else if (typeof obj.tags === 'string') out.tags = cleanTags(obj.tags);
    }
    for (const c of cards.slice(0, 6)) {
      out.cards.push({
        kicker: c && typeof c.kicker === 'string' ? c.kicker : '',
        title: c && typeof c.title === 'string' ? c.title : '',
        body: c && typeof c.body === 'string' ? c.body : '',
      });
    }
    return out;
  }

  function cleanTags(text) {
    const seen = new Set();
    return String(text || '')
      .split(/[\s,，、#]+/)
      .map((t) => t.trim())
      .filter((t) => {
        if (!t || seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .slice(0, 10);
  }

  global.WX_AI = { SPEC_TEXT, buildMessages, callDeepseek, extractJSON, normalize, cleanTags };
})(window);
