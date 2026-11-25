// 消息正文渲染：Markdown 常用子集（角色 LLM 的回复多带 Markdown）+ 可点链接 + @提及高亮。
// 安全：所有文字先 esc() 再拼标签，只生成白名单里的标签；链接只收 http/https，href 也转义。不引第三方库。
// 支持：```代码块```、`行内代码`、# ## ### 标题、> 引用、- * + 无序列表、1. 有序列表、--- 分割线、
//      **粗体**、*斜体*、~~删除线~~、[文字](https://...)、裸 https:// 链接、@成员名。
// 不做（用户没要）：表格、图片展开、HTML 透传、下划线斜体（会误伤 snake_case）。
'use strict';
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  // 引用里再套引用最多几层。来源：实现者定，防恶意深嵌套把递归撑爆。
  const MAX_DEPTH = 4;
  // 裸链接只认 ASCII 可见字符（遇到中文、空格、引号、尖括号就停），末尾标点不算进链接。
  const URL_CHAR = "[!#-&(-;=?-_a-~]";   // \x21-\x7e 去掉 " ' < > `
  const URL_TAIL = "[#$%&*+\\-/0-9=?@A-Z\\\\^_a-z|~]";   // 不以 . , ; : ! ? ( ) [ ] { } 结尾
  const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function emphasis(h) {   // h 已转义（不含 < > " '），只往里加固定标签
    return h.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
            .replace(/~~([^~\n]+?)~~/g, "<del>$1</del>")
            .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1<em>$2</em>");
  }

  // me：提到我自己 {aliases: 库里我的名字, shown: 页面上显示成什么}，画成 Discord 提到自己那样的高亮。
  // 只改显示；后面不能紧跟字母数字下划线，同 rh/hub.py 判断 @ 我的写法（USER_ALIASES）
  function inline(s, names, me) {
    const parts = s.split(/(`[^`\n]+`)/);
    const nm = "|@(" + (names.length ? names.map(reEscape).join("|") : "(?!)") + ")";
    const self = "|@(" + (me && me.aliases.length ? me.aliases.map(reEscape).join("|") : "(?!)") + ")(?![A-Za-z0-9_])";
    const re = new RegExp("\\[([^\\]\\n]+)\\]\\((https?://" + URL_CHAR + "+?)\\)|(https?://" + URL_CHAR + "*" + URL_TAIL + ")" + self + nm, "g");
    return parts.map((p, i) => {
      if (i % 2) return "<code>" + esc(p.slice(1, -1)) + "</code>";
      let out = "", last = 0, m;
      while ((m = re.exec(p))) {
        out += emphasis(esc(p.slice(last, m.index)));
        if (m[1] !== undefined) out += `<a href="${esc(m[2])}" target="_blank" rel="noopener noreferrer">${emphasis(esc(m[1]))}</a>`;
        else if (m[3] !== undefined) out += `<a href="${esc(m[3])}" target="_blank" rel="noopener noreferrer">${esc(m[3])}</a>`;
        else if (m[4] !== undefined) out += `<span class="mention me">@${esc(me.shown)}</span>`;
        else out += `<span class="mention">@${esc(m[5])}</span>`;
        last = re.lastIndex;
      }
      return out + emphasis(esc(p.slice(last)));
    }).join("");
  }

  function blocks(text, names, depth, me) {
    const lines = text.split("\n"), out = [];
    let para = [];
    const flush = () => { if (para.length) out.push(`<div class="p">${para.map(l => inline(l, names, me)).join("<br>")}</div>`); para = []; };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if ((m = line.match(/^\s*```/))) {   // 代码块：没收尾就到结尾（被打断的话常这样）
        flush();
        const code = [];
        for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i]);
        out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      } else if (!line.trim()) {
        flush();
      } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
        flush(); out.push(`<div class="h h${m[1].length}">${inline(m[2], names, me)}</div>`);
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush(); out.push("<hr>");
      } else if (/^>/.test(line) && depth < MAX_DEPTH) {
        flush();
        const q = [];
        for (; i < lines.length && /^>/.test(lines[i]); i++) q.push(lines[i].replace(/^>\s?/, ""));
        i--;
        out.push(`<blockquote>${blocks(q.join("\n"), names, depth + 1, me)}</blockquote>`);
      } else if (/^\s*([-*+]|\d{1,9}[.)])\s+/.test(line)) {
        flush();
        const ordered = /^\s*\d/.test(line), items = [];
        const item = ordered ? /^\s*(\d{1,9})[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
        const start = ordered ? parseInt(line.match(item)[1], 10) : 1;
        for (; i < lines.length && (m = lines[i].match(item)); i++) items.push(`<li>${inline(ordered ? m[2] : m[1], names, me)}</li>`);
        i--;
        out.push(ordered ? `<ol${start !== 1 ? ` start="${start}"` : ""}>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      } else {
        para.push(line);
      }
    }
    flush();
    return out.join("");
  }

  // names：可被 @ 的成员名字（长的优先，免得“鲸鱼娘”被“鲸鱼”先吃掉）。me：见 inline，不给就不认提到我。
  const sortNames = (names) => [...new Set((names || []).filter(n => n && !/\s/.test(n)))].sort((a, b) => b.length - a.length);
  window.renderMarkdown = function (text, names, me) {
    return blocks(String(text).replace(/\r\n?/g, "\n"), sortNames(names), 0, me);
  };
  // 只做行内（粗体、斜体、删除线、行内代码、链接、@）、每行分开画、换行原样留着：给 bot 的进度卡片、子进程表（hub.html msgHTML）。
  // 卡片每行都以图标或「第 N 步」开头，Discord 那边也不会出现标题、列表这类块级写法。
  window.renderMarkdownInline = function (text, names, me) {
    const ns = sortNames(names);
    return String(text).replace(/\r\n?/g, "\n").split("\n").map(l => inline(l, ns, me)).join("\n");
  };
})();
