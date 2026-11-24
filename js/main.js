import { authApi, configured, db } from './db.js';
import { SHARED_EMAIL } from './config.js';
import { state, loadMembers, loadSettings, activeMembers, memberById, chip, colorOf } from './state.js';
import { $, esc, toast, errMsg, modal, hashPin, PIN_INPUT } from './util.js';
import { renderCalendar } from './calendar.js';
import { renderMoney } from './money.js';
import { renderBoard } from './board.js';
import { renderSettings, memberFormContent, saveMember } from './settings.js';

const app = $('#app');
const ME_KEY = 'haitu.me';

const ICONS = {
  calendar: '<path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  board: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const TABS = [
  { id: 'calendar', label: '予約', render: renderCalendar },
  { id: 'money', label: '精算', render: renderMoney },
  { id: 'board', label: '掲示板', render: renderBoard },
  { id: 'settings', label: '設定', render: renderSettings },
];

const ctx = { switchUser, logout, refreshHeader };

function storeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } }

// ---------------------------------------------------------
// 起動
// ---------------------------------------------------------
async function boot() {
  if (!configured) return renderNotConfigured();
  await authApi.ready();
  if (!authApi.user()) return renderLogin();
  await startApp();
}

function renderNotConfigured() {
  app.innerHTML = `
    <div class="center-screen">
      <div class="card narrow">
        <h1>初期設定が必要です</h1>
        <p><code>js/config.js</code> に Firebase の設定値を書き込んでください。</p>
        <p class="muted small">手順は README.md にあります。</p>
      </div>
    </div>`;
}

function renderLogin() {
  document.title = 'ログイン';
  app.innerHTML = `
    <div class="center-screen">
      <form class="card narrow stack" data-login>
        <div class="logo" aria-hidden="true">🏠</div>
        <h1>合言葉を入力</h1>
        <p class="muted small">メンバーから聞いた合言葉を入れてください。<br>一度入れれば、この端末では次から不要です。</p>
        <input name="password" type="password" required autocomplete="current-password" placeholder="合言葉" aria-label="合言葉">
        <button type="submit" class="btn primary block">はじめる</button>
      </form>
    </div>`;
  const form = $('[data-login]');
  form.password.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await authApi.signIn(SHARED_EMAIL, form.password.value);
    } catch (err) {
      toast(errMsg(err), 'error');
      form.password.select();
      return;
    } finally {
      btn.disabled = false;
    }
    await startApp();
  };
}

async function startApp() {
  try {
    await Promise.all([loadMembers(), loadSettings()]);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="center-screen"><div class="card narrow">
      <h1>読み込めませんでした</h1><p>${esc(errMsg(err))}</p>
      <button type="button" class="btn primary" onclick="location.reload()">再読み込み</button></div></div>`;
    return;
  }
  const saved = storeGet(ME_KEY);
  state.meId = activeMembers().some((m) => m.id === saved) ? saved : null;
  if (!state.meId) return renderWhoAmI();
  renderShell();
}

// ---------------------------------------------------------
// 「あなたは誰？」
// ---------------------------------------------------------
function renderWhoAmI() {
  document.title = state.settings.house_name;
  const list = activeMembers();
  app.innerHTML = `
    <div class="center-screen">
      <div class="card narrow stack">
        <h1>${list.length ? 'あなたは誰ですか？' : '最初のメンバーを登録'}</h1>
        <p class="muted small">${list.length
          ? '自分の名前をタップしてください。'
          : '一緒に借りている人を登録しましょう。まずはあなたの名前から。'}</p>
        <div class="who-list">
          ${list.map((m) => `<button type="button" class="who" data-id="${m.id}" style="--c:${colorOf(m)}">${esc(m.name)}</button>`).join('')}
        </div>
        <button type="button" class="btn ${list.length ? 'ghost' : 'primary'} block" data-add>＋ ${list.length ? '名前がない場合は追加' : 'メンバーを追加'}</button>
      </div>
    </div>`;
  app.querySelector('.who-list').onclick = (e) => {
    const b = e.target.closest('[data-id]');
    if (b) askPin(b.dataset.id);
  };
  app.querySelector('[data-add]').onclick = () => modal({
    title: 'メンバーを追加',
    content: memberFormContent({}),
    submitLabel: '追加',
    onSubmit: async (form) => {
      const id = await saveMember(form, {});
      if (!id) return false;
      await loadMembers();
      renderWhoAmI();
    },
  });
}

let pinFails = 0;
let pinLockedUntil = 0;

/** 名前を選んだら4桁のPINで本人確認。PIN未設定ならここで決める */
async function askPin(id) {
  await loadMembers().catch(() => {});
  const m = memberById(id);
  if (!m) return;
  const hasPin = !!m.pin_hash;
  const { dlg, form } = modal({
    title: hasPin ? `${m.name}さんのPIN` : `${m.name}さんのPINを決める`,
    content: hasPin ? `
      <label class="field">4桁のPINを入力してください<input name="pin" ${PIN_INPUT}></label>
      <p class="muted small">忘れた場合は、他のメンバーに「設定 → メンバー」からリセットしてもらってください。</p>` : `
      <p class="muted small">本人確認のための4桁の数字を決めてください。次から名前を選ぶときに使います。</p>
      <label class="field">新しいPIN（4桁の数字）<input name="pin" ${PIN_INPUT}></label>
      <label class="field">もう一度<input name="pin2" ${PIN_INPUT}></label>`,
    submitLabel: hasPin ? 'OK' : '決定',
    onSubmit: async (f) => {
      const pin = f.pin.value;
      if (hasPin) {
        if (Date.now() < pinLockedUntil) {
          toast('間違いが続いたため、30秒待ってから入力してください', 'error');
          return false;
        }
        if (await hashPin(m.id, pin) !== m.pin_hash) {
          pinFails += 1;
          if (pinFails >= 5) { pinFails = 0; pinLockedUntil = Date.now() + 30000; }
          toast('PINが違います', 'error');
          f.pin.value = '';
          f.pin.focus();
          return false;
        }
        pinFails = 0;
      } else {
        if (pin !== f.pin2.value) { toast('2回の入力が一致しません', 'error'); return false; }
        await db.update('members', m.id, { pin_hash: await hashPin(m.id, pin) });
        await loadMembers();
      }
      chooseMe(m.id);
    },
  });
  // 4桁入れたら自動で確認
  if (hasPin) {
    form.pin.addEventListener('input', () => { if (/^\d{4}$/.test(form.pin.value)) form.requestSubmit(); });
  }
  form.pin.focus();
  return dlg;
}

function chooseMe(id) {
  state.meId = id;
  storeSet(ME_KEY, id);
  renderShell();
}

function switchUser() {
  state.meId = null;
  storeSet(ME_KEY, null);
  renderWhoAmI();
}

async function logout() {
  await authApi.signOut();
  state.meId = null;
  storeSet(ME_KEY, null);
  renderLogin();
}

// ---------------------------------------------------------
// メイン画面
// ---------------------------------------------------------
function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <h1 data-house></h1>
      <button type="button" class="me-btn" data-me aria-label="利用者を切り替え"></button>
    </header>
    <main id="view" class="view"></main>
    <nav class="tabbar">
      ${TABS.map((t) => `
        <a href="#/${t.id}" data-tab="${t.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t.id]}</svg>
          <span>${t.label}</span>
        </a>`).join('')}
    </nav>`;
  $('[data-me]').onclick = () => { if (confirm('利用者を切り替えますか？')) switchUser(); };
  refreshHeader();
  route();
}

function refreshHeader() {
  const h = $('[data-house]');
  if (!h) return;
  h.textContent = state.settings.house_name;
  document.title = state.settings.house_name;
  $('[data-me]').innerHTML = chip(memberById(state.meId));
}

async function route() {
  const view = $('#view');
  if (!view) return;
  const id = location.hash.replace(/^#\/?/, '') || 'calendar';
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  document.querySelectorAll('[data-tab]').forEach((a) =>
    a.setAttribute('aria-current', a.dataset.tab === tab.id ? 'page' : 'false'));
  view.innerHTML = '<p class="empty">読み込み中…</p>';
  window.scrollTo(0, 0);
  try {
    await tab.render(view, ctx);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><p>${esc(errMsg(err))}</p>
      <button type="button" class="btn primary" data-retry>もう一度</button></div>`;
    view.querySelector('[data-retry]').onclick = route;
  }
}

window.addEventListener('hashchange', route);
boot().catch((err) => {
  console.error(err);
  app.innerHTML = `<div class="center-screen"><div class="card narrow"><p>${esc(errMsg(err))}</p></div></div>`;
});
