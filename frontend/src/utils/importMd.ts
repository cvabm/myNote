import { api } from '../api';
import type { Notebook } from '../types';

export type ImportFile = {
  /** 相对路径，如 a/b/note.md；无目录时仅为文件名 */
  relativePath: string;
  content: string;
};

export type ImportOptions = {
  /** true：不按文件夹建笔记本，全部进默认笔记本 */
  flat: boolean;
  skipEmpty: boolean;
  onProgress?: (done: number, total: number, current: string) => void;
};

function resolveDefaultNotebookId(list: Notebook[]): string | null {
  const def = list.find((n) => n.name === '默认笔记本');
  return def?.id ?? list.find((n) => !n.parentId)?.id ?? list[0]?.id ?? null;
}

export type ImportResult = {
  ok: number;
  skip: number;
  fail: number;
  errors: string[];
};

export function titleFromMarkdown(content: string, fileName: string): string {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*#\s+(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return fileName.replace(/\.(md|markdown)$/i, '') || '未命名笔记';
}

function normalizeRelPath(p: string) {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '');
}

/** 从浏览器 File 列表构造导入项（支持 webkitRelativePath） */
export async function filesToImportList(fileList: FileList | File[]): Promise<ImportFile[]> {
  const files = Array.from(fileList).filter((f) => /\.(md|markdown)$/i.test(f.name));
  const out: ImportFile[] = [];
  for (const f of files) {
    const content = await f.text();
    const relativePath = normalizeRelPath(
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    );
    out.push({ relativePath, content });
  }
  // 去掉路径第一段（选文件夹时浏览器会带上根文件夹名）
  // 若所有文件都共享同一顶级目录，则剥掉，避免多出一个多余笔记本
  if (out.length > 0) {
    const firstSegs = out.map((x) => x.relativePath.split('/')[0]);
    const allSameRoot =
      firstSegs.every((s) => s === firstSegs[0]) &&
      out.every((x) => x.relativePath.includes('/'));
    if (allSameRoot) {
      const root = firstSegs[0];
      for (const item of out) {
        item.relativePath = item.relativePath.slice(root.length + 1) || item.relativePath;
      }
    }
  }
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh'));
  return out;
}

export async function importMarkdownFiles(
  items: ImportFile[],
  options: ImportOptions
): Promise<ImportResult> {
  const result: ImportResult = { ok: 0, skip: 0, fail: 0, errors: [] };
  const existing = await api.listNotebooks();
  /** pathKey -> id，如 "工作/项目A" */
  const cache = new Map<string, string>();

  const list: Notebook[] = [...existing];
  let defaultNotebookId = resolveDefaultNotebookId(list);

  // 没有默认笔记本时自动创建一个
  if (!defaultNotebookId) {
    const created = await api.createNotebook({ name: '默认笔记本', parentId: null });
    list.push(created);
    defaultNotebookId = created.id;
  }

  async function ensureNotebookPath(relDir: string): Promise<string | null> {
    // 扁平导入：全部进默认笔记本
    if (options.flat) return defaultNotebookId;
    // 根目录文件：进默认笔记本（与新建笔记一致）
    if (!relDir || relDir === '.') return defaultNotebookId;

    const parts = relDir.split('/').filter(Boolean);
    let parentId: string | null = null;
    let pathKey = '';
    for (const name of parts) {
      pathKey = pathKey ? `${pathKey}/${name}` : name;
      if (cache.has(pathKey)) {
        parentId = cache.get(pathKey)!;
        continue;
      }
      let found = list.find(
        (n) => n.name === name && (n.parentId || null) === (parentId || null)
      );
      if (!found) {
        found = await api.createNotebook({ name, parentId });
        list.push(found);
      }
      cache.set(pathKey, found.id);
      parentId = found.id;
    }
    return parentId;
  }

  const total = items.length;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fileName = item.relativePath.split('/').pop() || item.relativePath;
    options.onProgress?.(i, total, item.relativePath);

    if (options.skipEmpty && !item.content.trim()) {
      result.skip++;
      continue;
    }

    try {
      const dir = item.relativePath.includes('/')
        ? item.relativePath.slice(0, item.relativePath.lastIndexOf('/'))
        : '';
      const notebookId = (await ensureNotebookPath(dir)) ?? defaultNotebookId;
      const title = titleFromMarkdown(item.content, fileName);
      await api.createNote({
        title,
        content: item.content,
        notebookId,
      });
      result.ok++;
    } catch (e) {
      result.fail++;
      result.errors.push(
        `${item.relativePath}: ${e instanceof Error ? e.message : '导入失败'}`
      );
    }
  }
  options.onProgress?.(total, total, '完成');
  return result;
}
