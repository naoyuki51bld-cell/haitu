import { db } from './db.js';
import { esc } from './util.js';

export const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export const state = {
  members: [],
  settings: { house_name: 'セカンドハウス', default_rent: 0, default_parking: 0, default_payer_id: null },
  meId: null,
};

export async function loadMembers() {
  const list = await db.list('members');
  list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  state.members = list.map((m) => ({ ...m, active: m.active !== false }));
}

export async function loadSettings() {
  const s = await db.get('settings', 'main');
  if (s) state.settings = { ...state.settings, ...s };
}

export const memberById = (id) => state.members.find((m) => m.id === id);
export const activeMembers = () => state.members.filter((m) => m.active);
export const me = () => memberById(state.meId);

const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#64748b');
export const colorOf = (m) => safeColor(m?.color);

export function chip(m) {
  return `<span class="chip" style="--c:${colorOf(m)}">${esc(m?.name ?? '（不明）')}</span>`;
}

/** メンバーの <option> 一覧。選択中のメンバーは退出済みでも表示する */
export function memberOptions(selectedId, { allowEmpty = false } = {}) {
  const list = state.members.filter((m) => m.active || m.id === selectedId);
  return (allowEmpty ? '<option value="">（未設定）</option>' : '') +
    list.map((m) =>
      `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
}
