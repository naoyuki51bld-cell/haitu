import { sb, q } from './db.js';
import { state, memberById, activeMembers, chip, memberOptions } from './state.js';
import { esc, yen, ym, fmtMonth, shiftMonth, modal, toast, errMsg, $$ } from './util.js';

let month = ym(new Date());
let drawToken = 0;

const DEFAULT_ITEMS = ['電気', 'ガス', '水道'];

export async function renderMoney(el) {
  el.innerHTML = `
    <section class="card">
      <div class="month-nav">
        <button type="button" class="icon-btn" data-prev aria-label="前の月">‹</button>
        <h2 data-title></h2>
        <button type="button" class="icon-btn" data-next aria-label="次の月">›</button>
      </div>
      <div data-body><p class="empty">読み込み中…</p></div>
    </section>
    <div data-pay></div>
    <h3 class="section-title">これまでの記録</h3>
    <div class="list" data-history></div>`;
  el.querySelector('[data-prev]').onclick = () => { month = shiftMonth(month, -1); draw(el); };
  el.querySelector('[data-next]').onclick = () => { month = shiftMonth(month, 1); draw(el); };
  await draw(el);
}

const itemsTotal = (b) => (b.items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);

export function calc(b) {
  const utilities = itemsTotal(b);
  const total = (Number(b.rent) || 0) + utilities;
  const split = Math.max(1, Number(b.split_count) || 1);
  const per = Math.floor(total / split);
  return { utilities, total, split, per, remainder: total - per * split };
}

function defaultBill(m, history) {
  const prev = history.find((h) => h.month < m);
  const labels = prev?.items?.length ? prev.items.map((it) => it.label) : DEFAULT_ITEMS;
  return {
    month: m,
    rent: prev?.rent ?? state.settings.default_rent ?? 0,
    items: labels.map((label) => ({ label, amount: 0 })),
    payer_id: prev?.payer_id ?? state.settings.default_payer_id ?? null,
    split_count: activeMembers().length || 1,
    _unsaved: true,
  };
}

async function draw(el) {
  const token = ++drawToken;
  const target = month;
  el.querySelector('[data-title]').textContent = fmtMonth(target);

  const [saved, payments, history] = await Promise.all([
    q(sb.from('bills').select('*').eq('month', target).maybeSingle()),
    q(sb.from('payments').select('*').eq('month', target)),
    q(sb.from('bills').select('*').order('month', { ascending: false }).limit(24)),
  ]);
  if (token !== drawToken) return;

  const bill = saved || defaultBill(target, history);
  const { utilities, total, split, per, remainder } = calc(bill);
  const payer = memberById(bill.payer_id);

  // ---- 内訳 ----
  const body = el.querySelector('[data-body]');
  body.innerHTML = `
    ${bill._unsaved ? `<p class="notice">この月の金額はまだ確定していません。<br>光熱費を入力して「保存」してください。</p>` : ''}
    <div class="per-person">
      <span class="label">1人あたり</span>
      <span class="amount">${yen(per)}</span>
      <span class="muted">${yen(total)} ÷ ${split}人</span>
    </div>
    <dl class="breakdown">
      <div><dt>家賃</dt><dd>${yen(bill.rent)}</dd></div>
      ${(bill.items || []).map((it) =>
        `<div class="sub"><dt>${esc(it.label)}</dt><dd>${yen(it.amount)}</dd></div>`).join('')}
      <div class="sub-total"><dt>光熱費など 計</dt><dd>${yen(utilities)}</dd></div>
      <div class="total"><dt>合計</dt><dd>${yen(total)}</dd></div>
    </dl>
    <p class="muted small">
      支払い者：${payer ? chip(payer) : '<span class="warn">未設定</span>'}
      ${remainder ? `<br>端数 ${yen(remainder)} は支払い者の負担になります` : ''}
    </p>
    <div class="row-end">
      <button type="button" class="btn primary" data-edit>${bill._unsaved ? '金額を入力する' : '編集'}</button>
    </div>`;
  body.querySelector('[data-edit]').onclick = () => openForm(el, bill);

  // ---- 支払い状況 ----
  const pay = el.querySelector('[data-pay]');
  const payers = activeMembers().filter((m) => m.id !== bill.payer_id);
  const paidIds = new Set(payments.map((p) => p.member_id));
  if (!payer) {
    pay.innerHTML = '';
  } else {
    const doneCount = payers.filter((m) => paidIds.has(m.id)).length;
    pay.innerHTML = `
      <h3 class="section-title">支払い状況 <span class="muted">${doneCount}/${payers.length}人</span></h3>
      <p class="muted small">${esc(payer.name)}さんへ、各自 <strong>${yen(per)}</strong> を支払ってください。</p>
      <div class="list">
        ${payers.map((m) => `
          <label class="list-row check-row">
            <input type="checkbox" data-member="${m.id}" ${paidIds.has(m.id) ? 'checked' : ''} ${bill._unsaved ? 'disabled' : ''}>
            ${chip(m)}
            <span class="grow strong">${yen(per)}</span>
            <span class="muted small">${paidIds.has(m.id) ? '支払い済み' : '未払い'}</span>
          </label>`).join('') || '<p class="empty">ほかのメンバーがいません</p>'}
      </div>
      ${bill._unsaved ? '<p class="muted small">金額を保存すると支払いチェックができるようになります。</p>' : ''}`;
    $$('[data-member]', pay).forEach((cb) => {
      cb.onchange = async () => {
        cb.disabled = true;
        try {
          if (cb.checked) {
            await q(sb.from('payments').upsert({ month: target, member_id: cb.dataset.member }));
          } else {
            await q(sb.from('payments').delete().eq('month', target).eq('member_id', cb.dataset.member));
          }
          draw(el);
        } catch (err) {
          toast(errMsg(err), 'error');
          cb.checked = !cb.checked;
          cb.disabled = false;
        }
      };
    });
  }

  // ---- 履歴 ----
  const hist = el.querySelector('[data-history]');
  hist.innerHTML = history.length
    ? history.map((h) => {
      const c = calc(h);
      return `<button type="button" class="list-row ${h.month === target ? 'current' : ''}" data-month="${h.month}">
        <span class="grow"><span class="strong">${fmtMonth(h.month)}</span>
          <span class="muted"> · 合計 ${yen(c.total)}</span></span>
        <span class="strong">${yen(c.per)}<span class="muted small">/人</span></span>
        <span class="chev">›</span>
      </button>`;
    }).join('')
    : '<p class="empty">まだ記録はありません</p>';
  hist.onclick = (e) => {
    const row = e.target.closest('[data-month]');
    if (!row) return;
    month = row.dataset.month;
    draw(el);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}

function itemRow(it = { label: '', amount: '' }) {
  return `<div class="item-row">
    <input name="label" placeholder="項目名" maxlength="20" value="${esc(it.label)}">
    <input name="amount" type="number" inputmode="numeric" min="0" step="1" placeholder="0"
      value="${it.amount === 0 || it.amount ? esc(it.amount) : ''}">
    <button type="button" class="icon-btn" data-remove aria-label="この項目を削除">✕</button>
  </div>`;
}

function openForm(el, bill) {
  const { dlg } = modal({
    title: `${fmtMonth(bill.month)}の金額`,
    content: `
      <label class="field">支払い者（まとめて払う人）
        <select name="payer_id" required>${memberOptions(bill.payer_id, { allowEmpty: !bill.payer_id })}</select>
      </label>
      <label class="field">家賃（円）
        <input name="rent" type="number" inputmode="numeric" min="0" step="1" required value="${Number(bill.rent) || 0}">
      </label>
      <div class="field">光熱費など（円）
        <div data-items>${(bill.items || []).map(itemRow).join('')}</div>
        <button type="button" class="btn ghost small" data-add-item>＋ 項目を追加</button>
      </div>
      <label class="field">割る人数
        <input name="split_count" type="number" inputmode="numeric" min="1" max="50" step="1" required value="${bill.split_count || 1}">
        <span class="muted small">今のメンバーは ${activeMembers().length} 人です</span>
      </label>
      <p class="preview" data-preview></p>`,
    onSubmit: async (form) => {
      const items = $$('.item-row', form)
        .map((row) => ({
          label: row.querySelector('[name=label]').value.trim(),
          amount: Math.max(0, Math.round(Number(row.querySelector('[name=amount]').value) || 0)),
        }))
        .filter((it) => it.label || it.amount);
      if (items.some((it) => !it.label)) {
        toast('項目名を入力してください', 'error');
        return false;
      }
      const v = new FormData(form);
      if (!v.get('payer_id')) {
        toast('支払い者を選んでください', 'error');
        return false;
      }
      await q(sb.from('bills').upsert({
        month: bill.month,
        rent: Math.max(0, Math.round(Number(v.get('rent')) || 0)),
        items,
        payer_id: v.get('payer_id'),
        split_count: Math.max(1, Math.round(Number(v.get('split_count')) || 1)),
        updated_at: new Date().toISOString(),
      }));
      toast('保存しました');
      draw(el);
    },
  });

  const itemsEl = dlg.querySelector('[data-items]');
  const preview = dlg.querySelector('[data-preview]');
  const update = () => {
    const f = dlg.querySelector('form');
    const c = calc({
      rent: f.rent.value,
      items: $$('[name=amount]', itemsEl).map((i) => ({ amount: i.value })),
      split_count: f.split_count.value,
    });
    preview.innerHTML = `合計 ${yen(c.total)} → 1人あたり <strong>${yen(c.per)}</strong>`;
  };
  dlg.querySelector('[data-add-item]').onclick = () => {
    itemsEl.insertAdjacentHTML('beforeend', itemRow());
    itemsEl.lastElementChild.querySelector('input').focus();
    update();
  };
  itemsEl.onclick = (e) => {
    if (e.target.closest('[data-remove]')) { e.target.closest('.item-row').remove(); update(); }
  };
  dlg.addEventListener('input', update);
  update();
}
