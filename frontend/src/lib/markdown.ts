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

/**
 * 标题 slug：保留字母/数字/CJK 等文字，空格转 `-`。
 * 与 GitHub 风格接近，便于手写 `[跳转](#标题)`。
 */
export function slugifyHeading(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s\-_]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'section';
}

export type TocItem = {
  /** 1–6 */
  depth: number;
  /** 展示用标题（尽量去掉常见行内标记） */
  text: string;
  /** 与渲染结果 `<hN id="...">` 一致 */
  id: string;
};

/** 根据与 heading renderer 相同的规则生成去重 id */
function nextHeadingId(text: string, counts: Map<string, number>): string {
  const base = slugifyHeading(text);
  const n = counts.get(base) ?? 0;
  counts.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

/** 展示用：去掉常见 Markdown 行内标记，保留可读文字 */
function headingDisplayText(raw: string): string {
  const t = raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || raw.trim() || '未命名';
}

/**
 * 从 Markdown 源码提取标题目录（与 renderMarkdown 的 id 规则一致）。
 * 使用 marked.lexer，自动跳过代码块内的 `#`。
 */
export function extractHeadings(md: string): TocItem[] {
  const counts = new Map<string, number>();
  const items: TocItem[] = [];
  try {
    const tokens = marked.lexer(md || '');
    for (const token of tokens) {
      if (token.type !== 'heading') continue;
      const h = token as Tokens.Heading;
      const text = headingDisplayText(h.text);
      const id = nextHeadingId(h.text, counts);
      items.push({ depth: h.depth, text, id });
    }
  } catch {
    // 解析失败时不提供目录
  }
  return items;
}

/** 单次渲染内的标题 id 去重计数 */
let headingSlugCounts: Map<string, number> | null = null;

function uniqueHeadingId(text: string): string {
  if (!headingSlugCounts) headingSlugCounts = new Map();
  return nextHeadingId(text, headingSlugCounts);
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

/** 渲染时是否显示图片删除按钮（可编辑预览） */
let imageDeleteEnabled = false;

marked.use({
  renderer: {
    heading(this: { parser: { parseInline: (t: Tokens.Heading['tokens']) => string } }, {
      tokens,
      depth,
      text,
    }: Tokens.Heading) {
      const id = uniqueHeadingId(text);
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${escapeHtml(id)}">${inner}</h${depth}>\n`;
    },
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
    image({ href, title, text }: Tokens.Image) {
      const src = href || '';
      const alt = text || '';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy" />`;
      if (!imageDeleteEnabled) {
        return img;
      }
      return `<span class="md-img-wrap">
  ${img}
  <button type="button" class="md-img-delete" data-src="${escapeHtml(src)}" title="删除图片">删除</button>
</span>`;
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

/**
 * 将 [[标题]] / [[标题|别名]] 转为可识别的 wiki 链接（预览用）。
 * 跳过 fenced code / 行内 code 内的匹配由粗略分段完成。
 */
function expandWikiLinks(md: string): string {
  if (!md || !md.includes('[[')) return md;
  const parts = md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g);
  return parts
    .map((part) => {
      if (
        part.startsWith('```') ||
        part.startsWith('~~~') ||
        (part.startsWith('`') && part.endsWith('`'))
      ) {
        return part;
      }
      return part.replace(/\[\[([^\]\n]+)\]\]/g, (_m, inner: string) => {
        let raw = String(inner || '').trim();
        if (!raw) return _m;
        let display = raw;
        const pipe = raw.indexOf('|');
        if (pipe >= 0) {
          display = raw.slice(pipe + 1).trim() || raw.slice(0, pipe).trim();
          raw = raw.slice(0, pipe).trim();
        }
        const hash = raw.indexOf('#');
        const target = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
        if (!target) return _m;
        const label = display || target;
        // 使用自定义 scheme，预览中可样式化；后续可接跳转
        return `[${label}](wiki://${encodeURIComponent(target)})`;
      });
    })
    .join('');
}

export function renderMarkdown(
  md: string,
  opts?: { showImageDelete?: boolean }
): string {
  imageDeleteEnabled = !!opts?.showImageDelete;
  headingSlugCounts = new Map();
  try {
    const expanded = expandWikiLinks(md || '');
    const raw = marked.parse(expanded, { async: false }) as string;
    return sanitizeHtml(raw);
  } catch {
    return `<pre>${escapeHtml(md || '')}</pre>`;
  } finally {
    imageDeleteEnabled = false;
    headingSlugCounts = null;
  }
}

/** 从 Markdown 正文中移除指定 src 的图片语法 */
export function removeImageFromMarkdown(content: string, src: string): string {
  if (!src) return content;
  const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ![alt](src) 或 ![alt](src "title")
  const re = new RegExp(`!\\[[^\\]]*\\]\\(${escaped}(?:\\s+"[^"]*")?\\)`, 'g');
  return content
    .replace(re, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

/** 从 /uploads/xxx.jpg 提取文件名 */
export function uploadNameFromSrc(src: string): string | null {
  try {
    const pathOnly = src.split('?')[0].split('#')[0];
    const m = pathOnly.match(/\/uploads\/([^/]+)$/i);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}
