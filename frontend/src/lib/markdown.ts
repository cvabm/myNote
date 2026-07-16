import { marked, type Tokens } from 'marked';
import hljs from 'highlight.js/lib/core';

// 常用语言按需注册，避免整包 highlight.js 过大
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

import 'highlight.js/styles/github-dark.min.css';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', shell);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c++', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('php', php);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('svg', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightCode(code: string, lang?: string) {
  const name = (lang || '').trim().toLowerCase();
  try {
    if (name && hljs.getLanguage(name)) {
      return hljs.highlight(code, { language: name }).value;
    }
    // 无语言标记时不自动猜测（避免误高亮、也更快）
    return escapeHtml(code);
  } catch {
    return escapeHtml(code);
  }
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

marked.use({
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const langName = (lang || '').split(/\s+/)[0] || '';
      const langClass = langName ? ` language-${escapeHtml(langName)}` : '';
      const highlighted = highlightCode(text, langName);
      const label = escapeHtml(langName || 'code');
      // 原始代码放隐藏 textarea，便于一键复制（避免 data 属性转义麻烦）
      return `<div class="code-block">
  <div class="code-block-bar">
    <span class="code-lang">${label}</span>
    <button type="button" class="code-copy-btn">复制</button>
  </div>
  <pre class="hljs-pre"><code class="hljs${langClass}">${highlighted}</code></pre>
  <textarea class="code-raw" readonly hidden>${escapeHtml(text)}</textarea>
</div>\n`;
    },
  },
});

/** 基础消毒：去掉 script / on* 事件 */
function sanitizeHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export function renderMarkdown(md: string): string {
  try {
    const raw = marked.parse(md || '', { async: false }) as string;
    return sanitizeHtml(raw);
  } catch {
    return `<pre>${escapeHtml(md || '')}</pre>`;
  }
}
