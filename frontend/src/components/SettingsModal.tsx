import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api } from '../api';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SettingsModal({ open, onClose }: Props) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    setLoading(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setMsg('密码已修改');
      setOldPassword('');
      setNewPassword('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : '修改失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-t-2xl bg-white shadow-2xl safe-pb sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold">设置</h2>
          <button type="button" className="btn-ghost !p-2" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 p-5">
          <p className="text-sm text-slate-500">修改登录密码（首次部署后请立即更换默认密码）</p>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">原密码</span>
            <input
              type="password"
              className="input text-base sm:text-sm"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">新密码（至少 6 位）</span>
            <input
              type="password"
              className="input text-base sm:text-sm"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          {msg && <div className="text-sm text-emerald-600">{msg}</div>}
          {err && <div className="text-sm text-red-600">{err}</div>}
          <button type="submit" className="btn-primary w-full sm:w-auto" disabled={loading}>
            {loading ? '保存中…' : '保存密码'}
          </button>
        </form>
      </div>
    </div>
  );
}
