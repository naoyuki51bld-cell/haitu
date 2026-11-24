import { db, authApi, deleteField } from './db.js';
import { state, COLORS, chip, me, memberOptions, loadMembers, loadSettings } from './state.js';
import { esc, modal, toast, errMsg, hashPin, PIN_INPUT } from './util.js';

/** ctx: { switchUser, logout, refreshHeader } */
export async function renderSettings(el, ctx) {
  const s = state.settings;
  el.innerHTML = `
    <section class="card">
      <h2 class="card-title">この端末</h2>
      <div class="list-row plain">
        <span class="grow">使っている人：${chip(me())}</span>
        <button type="button" class="btn ghost small" data-switch>切り替え</button>
      </div>
      <div class="row-end">
        <button type="button" class="btn ghost" data-pin>自分のPINを変更</button>
        <button type="button" class="btn danger-ghost" data-logout>ログアウト</button>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">メンバー</h2>
      <div class="list" data-members></div>
      <div class="row-end"><button type="button" class="btn ghost" data-add-member>＋ メンバーを追加</button></div>
    </section>

    <section class="card">
      <h2 class="card-title">ハウスの設定</h2>
      <form data-house class="stack">
        <label class="field">名前
          <input name="house_name" required maxlength="30" value="${esc(s.house_name)}">
        </label>
        <label class="field">家賃（毎月固定・円）
          <input name="default_rent" type="number" inputmode="numeric" min="0" step="1" value="${Number(s.default_rent) || 0}">
        </label>
        <label class="field">駐車場（毎月固定・円）
          <input name="default_parking" type="number" inputmode="numeric" min="0" step="1" value="${Number(s.default_parking) || 0}">
        </label>
        <label class="field">いつもの支払い者
          <select name="default_payer_id">${memberOptions(s.default_payer_id, { allowEmpty: true })}</select>
        </label>
        <div class="row-end"><button type="submit" class="btn primary">保存</button></div>
      </form>
    </section>

    <section class="card">
      <h2 class="card-title">合言葉の変更</h2>
      <form data-pass class="stack">
        <p class="muted small">変更すると、他のメンバーも次回から新しい合言葉でログインします。</p>
        <label class="field">新しい合言葉（6文字以上）
          <input name="password" type="password" minlength="6" required autocomplete="new-password">
        </label>
        <div class="row-end"><button type="submit" class="btn ghost">変更する</button></div>
      </form>
    </section>`;

  el.querySelector('[data-switch]').onclick = ctx.switchUser;
  el.querySelector('[data-logout]').onclick = () => { if (confirm('この端末からログアウトしますか？')) ctx.logout(); };
  el.querySelector('[data-add-member]').onclick = () => openMemberForm(el, ctx, {});
  el.querySelector('[data-pin]').onclick = () => openPinChange();

  drawMembers(el, ctx);

  el.querySelector('[data-house]').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const v = new FormData(f);
    try {
      await db.set('settings', 'main', {
        house_name: String(v.get('house_name')).trim() || 'セカンドハウス',
        default_rent: Math.max(0, Math.round(Number(v.get('default_rent')) || 0)),
        default_parking: Math.max(0, Math.round(Number(v.get('default_parking')) || 0)),
        default_payer_id: v.get('default_payer_id') || null,
      });
      await loadSettings();
      ctx.refreshHeader();
      toast('保存しました');
    } catch (err) { toast(errMsg(err), 'error'); }
  };

  el.querySelector('[data-pass]').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const pw = f.password.value;
    if (pw.length < 6) { toast('6文字以上にしてください', 'error'); return; }
    if (!confirm('合言葉を変更しますか？\n新しい合言葉をメンバーに伝えてください。')) return;
    try {
      await authApi.updatePassword(pw);
    } catch (err) { toast(errMsg(err), 'error'); return; }
    f.reset();
    toast('合言葉を変更しました');
  };
}

function drawMembers(el, ctx) {
  const list = el.querySelector('[data-members]');
  list.innerHTML = state.members.length
    ? state.members.map((m) => `
      <button type="button" class="list-row" data-id="${m.id}">
        ${chip(m)}
        <span class="grow muted small">${m.active ? '' : '退出済み'}${m.id === state.meId ? '（あなた）' : ''}</span>
        <span class="chev">›</span>
      </button>`).join('')
    : '<p class="empty">メンバーがいません</p>';
  list.onclick = (e) => {
    const row = e.target.closest('[data-id]');
    if (row) openMemberForm(el, ctx, state.members.find((m) => m.id === row.dataset.id));
  };
}

export function memberFormContent(m) {
  const color = m.color || COLORS[state.members.length % COLORS.length];
  return `
    <label class="field">名前
      <input name="name" required maxlength="30" value="${esc(m.name || '')}" placeholder="例：たろう">
    </label>
    <div class="field">色
      <div class="swatches">
        ${COLORS.map((c) => `
          <label class="swatch" style="--c:${c}">
            <input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''} aria-label="${c}">
          </label>`).join('')}
      </div>
    </div>
    ${m.id ? `<label class="check"><input type="checkbox" name="active" ${m.active ? 'checked' : ''}> 現在のメンバー（外すと精算の対象外になります）</label>` : ''}
    ${m.id && m.pin_hash ? `<label class="check"><input type="checkbox" name="reset_pin"> PINをリセットする（PINを忘れたとき用。次に名前を選んだときに決め直します）</label>` : ''}`;
}

export async function saveMember(form, m) {
  const v = new FormData(form);
  const row = { name: String(v.get('name')).trim(), color: v.get('color') || COLORS[0] };
  if (!row.name) { toast('名前を入力してください', 'error'); return null; }
  if (m.id) {
    row.active = v.get('active') === 'on';
    if (v.get('reset_pin') === 'on') {
      if (!confirm(`${row.name}さんのPINをリセットしますか？`)) return null;
      row.pin_hash = deleteField();
    }
    await db.update('members', m.id, row);
    return m.id;
  }
  return db.add('members', { ...row, active: true, sort_order: state.members.length });
}

function openMemberForm(el, ctx, m) {
  modal({
    title: m.id ? 'メンバーを編集' : 'メンバーを追加',
    content: memberFormContent(m),
    submitLabel: m.id ? '保存' : '追加',
    onSubmit: async (form) => {
      const id = await saveMember(form, m);
      if (!id) return false;
      await loadMembers();
      ctx.refreshHeader();
      toast('保存しました');
      drawMembers(el, ctx);
    },
  });
}

function openPinChange() {
  const m = me();
  modal({
    title: '自分のPINを変更',
    content: `
      <label class="field">今のPIN<input name="old" ${PIN_INPUT}></label>
      <label class="field">新しいPIN（4桁の数字）<input name="pin" ${PIN_INPUT}></label>
      <label class="field">新しいPIN（もう一度）<input name="pin2" ${PIN_INPUT}></label>`,
    submitLabel: '変更する',
    onSubmit: async (form) => {
      await loadMembers();
      const cur = me();
      if (cur?.pin_hash && await hashPin(m.id, form.old.value) !== cur.pin_hash) {
        toast('今のPINが違います', 'error');
        return false;
      }
      if (form.pin.value !== form.pin2.value) {
        toast('新しいPINが一致しません', 'error');
        return false;
      }
      await db.update('members', m.id, { pin_hash: await hashPin(m.id, form.pin.value) });
      await loadMembers();
      toast('PINを変更しました');
    },
  });
}
