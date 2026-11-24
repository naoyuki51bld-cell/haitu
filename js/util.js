export const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** エスケープ済みテキスト中の URL をリンクにする */
export function linkify(escaped) {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

export const yen = (n) => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);

export function fmtDate(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
}
export function fmtMonth(s) {
  const [y, m] = s.split('-').map(Number);
  return `${y}年${m}月`;
}
export function shiftMonth(s, n) {
  const d = parseYmd(s);
  return ym(new Date(d.getFullYear(), d.getMonth() + n, 1));
}
export function fmtDateTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = `${d.getHours()}:${pad(d.getMinutes())}`;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? `${md} ${time}` : `${d.getFullYear()}/${md} ${time}`;
}

/** 4桁PINのハッシュ（PINそのものは保存しない） */
export async function hashPin(memberId, pin) {
  const data = new TextEncoder().encode(`haitu:${memberId}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const PIN_INPUT = 'type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" required autocomplete="off" class="pin-input"';

export function errMsg(err) {
  const code = err?.code || '';
  const m = err?.message || String(err);
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return '合言葉が違います';
  if (/too-many-requests/.test(code)) return '何度も間違えたため、しばらくログインできません。少し待ってから試してください。';
  if (/requires-recent-login/.test(code)) return '安全のため、一度ログアウトして入り直してから変更してください。';
  if (/weak-password/.test(code)) return '合言葉は6文字以上にしてください。';
  if (/unavailable|network-request-failed/.test(code) || /Failed to fetch|NetworkError|Load failed|offline/i.test(m)) {
    return '通信できませんでした。電波を確認してください。';
  }
  if (/permission-denied|unauthenticated/.test(code)) return '権限がありません。ログインし直すか、セキュリティルールの設定を確認してください。';
  return 'エラー：' + m;
}

let toastTimer;
export function toast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), type === 'error' ? 4500 : 2200);
}

/**
 * フォーム付きモーダルを開く。
 * onSubmit(form) が false を返すと閉じない。
 * danger: { label, confirm, onClick } で削除ボタンを表示。
 */
export function modal({ title, content, submitLabel = '保存', onSubmit, danger, hideCancel }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form class="modal-form" novalidate>
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="閉じる">✕</button>
      </header>
      <div class="modal-body">${content}</div>
      <footer class="modal-foot">
        ${danger ? `<button type="button" class="btn danger-ghost" data-danger>${esc(danger.label)}</button>` : ''}
        <span class="spacer"></span>
        ${hideCancel ? '' : '<button type="button" class="btn ghost" data-close>キャンセル</button>'}
        ${onSubmit ? `<button type="submit" class="btn primary">${esc(submitLabel)}</button>` : ''}
      </footer>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const close = () => { if (dlg.open) dlg.close(); dlg.remove(); };
  $$('[data-close]', dlg).forEach((b) => (b.onclick = close));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

  const setBusy = (busy) => $$('button', dlg).forEach((b) => (b.disabled = busy));

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    setBusy(true);
    try {
      const keepOpen = (await onSubmit?.(form)) === false;
      if (!keepOpen) close();
    } catch (err) {
      console.error(err);
      toast(errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  if (danger) {
    dlg.querySelector('[data-danger]').onclick = async () => {
      if (danger.confirm && !confirm(danger.confirm)) return;
      setBusy(true);
      try { await danger.onClick(); close(); } catch (err) { toast(errMsg(err), 'error'); setBusy(false); }
    };
  }
  dlg.showModal();
  return { dlg, form, close };
}
