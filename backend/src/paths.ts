import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * backend/src 或 backend/dist → 仓库根目录（myNote/）。
 * Docker 中对应 /app。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(here, '..', '..');

/**
 * 解析数据路径：
 * - 绝对路径：原样使用（Docker 的 /app/data/...）
 * - 相对路径：相对**仓库根**，而不是 process.cwd()
 *   避免 `npm run dev --prefix backend` 时写到 backend/data/
 */
export function resolveDataPath(p: string): string {
  if (path.isAbsolute(p)) return path.normalize(p);
  return path.resolve(PROJECT_ROOT, p);
}
