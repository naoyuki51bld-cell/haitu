import { db, where, orderBy, limit, serverTimestamp, deleteField } from './db.js';
import { state, memberById, activeMembers, chip, colorOf, memberOptions } from './state.js';
import {
  esc, yen, ym, ymd, parseYmd, fmtMonth, shiftMonth, fmtDateTime, modal, toast, errMsg, $$,
} from './util.js';
import { nightsInRange } from './calendar.js';

// 4つの費用項目
//  fixed : 毎月固定（金額は設定画面で決める）
//  usage : 前月の泊数に応じて配分（多く泊まった人ほど多く払う）
//  ※ 各月のページの金額は、その月に「支払う」金額。光熱費は前月に使った分の請求なので、前月の泊数で割る。
export const CATS = [
  { key: 'rent', label: '家賃', fixed: true, rule: '均等割り' },
  { key: 'parking', label: '駐車場', fixed: true, rule: '均等割り' },
  { key: 'utilities', label: '光熱費', usage: true, rule: '前月の泊数に応じて配分' },
  { key: 'other', label: 'その他', rule: '均等割り' },
];
const SETTING_KEY = { rent: 'default_rent', parking: 'default_parking' };
const DEFAULT_UTIL = ['水道', '電気', 'ガス'];

let month = ym(new Date());
let drawToken = 0;

const num = (v) => Math.max(0, Math.round(Number(v) || 0));

function monthRange(m) {
  const s = parseYmd(`${m}-01`);
  return [ymd(s), ymd(new Date(s.getFullYear(), s.getMonth() + 1, 0))];
}

/** その月に各メンバーが泊まった夜の数 { memberId: 泊数 } */
/** 'YYYY-MM' の前月を「10月」の形で */
const prevLabel = (m) => `${Number(shiftMonth(m, -1).slice(5))}月`;

async function loadNights(m) {
  const [from, to] = monthRange(m);
  const list = await db.list('reservations', where('last_night', '>=', from));
  const nights = {};
  for (const r of list) {
    const n = nightsInRange(r, from, to);
    if (n) nights[r.member_id] = (nights[r.member_id] || 0) + n;
  }
  return nights;
}

/** 欠けている項目を補う（古い形式のデータにも対応） */
function normalize(b) {
  const all = activeMembers().map((m) => m.id);
  const shares = b.shares || {};
  let items;
  if (Array.isArray(b.utility_items)) {
    items = b.utility_items.map((it) => ({ label: String(it.label || ''), amount: num(it.amount) }));
  } else if (num(b.utilities) > 0) {
    items = [{ label: '光熱費', amount: num(b.utilities) }]; // 内訳のない古いデータ
  } else {
    items = DEFAULT_UTIL.map((label) => ({ label, amount: 0 }));
  }
  return {
    ...b,
    rent: num(b.rent),
    parking: num(b.parking),
    utility_items: items,
    utilities: items.reduce((sum, it) => sum + it.amount, 0),
    other: num(b.other),
    other_note: b.other_note || '',
    shares: Object.fromEntries(CATS.map((c) =>
      [c.key, Array.isArray(shares[c.key]) ? shares[c.key] : all])),
    paid: b.paid || {},
  };
}

function defaultBill(m, history) {
  const prev = history.find((h) => h.month < m);
  return normalize({
    month: m,
    rent: state.settings.default_rent,
    parking: state.settings.default_parking,
    utility_items: (prev?.utility_items?.length ? prev.utility_items.map((it) => it.label) : DEFAULT_UTIL)
      .map((label) => ({ label, amount: 0 })),
    other: 0,
    payer_id: prev?.payer_id ?? state.settings.default_payer_id ?? null,
    shares: prev?.shares,
    _unsaved: true,
  });
}

/**
 * 1人ずつの金額を計算。1円未満は切り捨て、端数は remainder（支払い者の負担）。
 * 光熱費は（呼び出し側が渡す）前月の泊数の比で配分。対象者が誰も泊まっていなければ均等割り。
 */
export function calc(b, nights) {
  const per = {};
  const cats = {};
  for (const c of CATS) {
    const amount = b[c.key];
    const ids = (b.shares[c.key] || []).filter((id) => memberById(id));
    const w = c.usage ? ids.map((id) => nights[id] || 0) : ids.map(() => 1);
    const W = w.reduce((s, x) => s + x, 0);
    const fallback = c.usage && W === 0;
    const weights = fallback ? ids.map(() => 1) : w;
    const T = fallback ? ids.length : W;
    cats[c.key] = { amount, ids, fallback };
    if (!amount || !ids.length) continue;
    ids.forEach((id, i) => {
      const v = Math.floor((amount * weights[i]) / T);
      per[id] ??= { total: 0 };
      per[id][c.key] = v;
      per[id].total += v;
    });
  }
  const total = CATS.reduce((s, c) => s + b[c.key], 0);
  const assigned = Object.values(per).reduce((s, p) => s + p.total, 0);
  return { per, cats, total, remainder: total - assigned };
}

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
    <div data-people></div>
    <h3 class="section-title">これまでの記録</h3>
    <div class="list" data-history></div>`;
  el.querySelector('[data-prev]').onclick = () => { month = shiftMonth(month, -1); draw(el); };
  el.querySelector('[data-next]').onclick = () => { month = shiftMonth(month, 1); draw(el); };
  await draw(el);
}

function paidInfo(p) {
  if (!p) return null;
  if (typeof p === 'string') return { at: p, by: null }; // 古い形式
  return { at: p.at, by: p.by };
}

async function draw(el) {
  const token = ++drawToken;
  const target = month;
  el.querySelector('[data-title]').textContent = fmtMonth(target);
  // 読み込み中に前の月のボタンを押せないように消しておく
  el.querySelector('[data-body]').innerHTML = '<p class="empty">読み込み中…</p>';
  el.querySelector('[data-people]').innerHTML = '';

  const [saved, history, nights] = await Promise.all([
    db.get('bills', target),
    db.list('bills', orderBy('month', 'desc'), limit(24)),
    loadNights(shiftMonth(target, -1)), // 光熱費は前月の泊数で配分
  ]);
  if (token !== drawToken) return;

  const bill = saved ? normalize(saved) : defaultBill(target, history);
  const { per, cats, total, remainder } = calc(bill, nights);
  const payer = memberById(bill.payer_id);

  // ---- 内訳 ----
  const catLine = (c) => {
    const info = cats[c.key];
    let rule = `${info.ids.length}人で${c.rule}`;
    if (c.usage && info.fallback) rule = `${info.ids.length}人で均等割り（${prevLabel(bill.month)}の宿泊なし）`;
    if (!info.ids.length && info.amount) rule = '<span class="warn">対象者がいません</span>';
    const label = c.key === 'other' && bill.other_note ? `その他（${esc(bill.other_note)}）` : c.label;
    const subs = c.usage
      ? bill.utility_items.filter((it) => it.amount > 0)
        .map((it) => `<div class="sub"><dt>${esc(it.label)}</dt><dd>${yen(it.amount)}</dd></div>`).join('')
      : '';
    return `<div><dt>${label}<span class="rule">${rule}</span></dt><dd>${yen(info.amount)}</dd></div>${subs}`;
  };
  const body = el.querySelector('[data-body]');
  body.innerHTML = `
    ${bill._unsaved ? '<p class="notice">この月の金額はまだ確定していません。<br>光熱費などを入力して「保存」してください。</p>' : ''}
    <dl class="breakdown">
      ${CATS.map(catLine).join('')}
      <div class="total"><dt>合計</dt><dd>${yen(total)}</dd></div>
    </dl>
    <p class="muted small">
      支払い者（まとめて払う人）：${payer ? chip(payer) : '<span class="warn">未設定</span>'}
      ${remainder ? `<br>端数 ${yen(remainder)} は支払い者の負担になります` : ''}
    </p>
    <div class="row-end">
      <button type="button" class="btn primary" data-edit>${bill._unsaved ? '金額を入力する' : '編集'}</button>
    </div>`;
  body.querySelector('[data-edit]').onclick = () => openForm(el, bill, nights);

  // ---- 1人ずつ ----
  const people = state.members.filter((m) => per[m.id] || m.id === bill.payer_id);
  const debtors = people.filter((m) => m.id !== bill.payer_id && per[m.id]?.total > 0);
  const doneCount = debtors.filter((m) => bill.paid[m.id]).length;
  const peopleEl = el.querySelector('[data-people]');
  peopleEl.innerHTML = `
    <h3 class="section-title">1人ずつの金額
      ${payer && debtors.length ? `<span class="muted">支払い済み ${doneCount}/${debtors.length}人</span>` : ''}</h3>
    ${payer ? `<p class="muted small">${esc(payer.name)}さん以外の人は、${esc(payer.name)}さんに自分の金額を払ってください。</p>` : ''}
    <div class="list">
      ${people.map((m) => personHtml(m, per[m.id], nights[m.id] || 0, bill, payer)).join('') ||
        '<p class="empty">対象のメンバーがいません</p>'}
    </div>
    ${bill._unsaved && payer ? '<p class="muted small">金額を保存すると、支払いチェックができるようになります。</p>' : ''}`;

  $$('[data-member]', peopleEl).forEach((cb) => {
    cb.onchange = async () => {
      const id = cb.dataset.member;
      if (!cb.checked && !confirm(`${memberById(id)?.name}さんの「支払い済み」を取り消しますか？`)) {
        cb.checked = true;
        return;
      }
      cb.disabled = true;
      try {
        await db.update('bills', target, {
          [`paid.${id}`]: cb.checked ? { at: serverTimestamp(), by: state.meId } : deleteField(),
        });
        toast(cb.checked ? '支払い済みにしました' : '取り消しました');
        draw(el);
      } catch (err) {
        toast(errMsg(err), 'error');
        cb.checked = !cb.checked;
        cb.disabled = false;
      }
    };
  });

  // ---- 履歴 ----
  const hist = el.querySelector('[data-history]');
  hist.innerHTML = history.length
    ? history.map((h) => {
      const t = CATS.reduce((s, c) => s + num(h[c.key]), 0);
      return `<button type="button" class="list-row ${h.month === target ? 'current' : ''}" data-month="${h.month}">
        <span class="grow strong">${fmtMonth(h.month)}</span>
        <span class="muted">合計</span><span class="strong">${yen(t)}</span>
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

function personHtml(m, p = { total: 0 }, n, bill, payer) {
  const isPayer = m.id === bill.payer_id;
  const parts = CATS.filter((c) => p[c.key] != null).map((c) =>
    `${c.label} ${yen(p[c.key])}${c.usage ? `（${prevLabel(bill.month)} ${n}泊）` : ''}`);
  let payRow = '';
  if (isPayer) {
    payRow = '<div class="pay-row muted small">みんなから受け取る人</div>';
  } else if (payer && p.total > 0) {
    const info = paidInfo(bill.paid[m.id]);
    const by = info?.by ? memberById(info.by)?.name : null;
    payRow = `<label class="pay-row">
      <input type="checkbox" data-member="${m.id}" ${info ? 'checked' : ''} ${bill._unsaved ? 'disabled' : ''}>
      <span class="${info ? 'paid' : ''}">${info ? '支払い済み' : '未払い'}</span>
      ${info ? `<span class="muted small stamp">${info.at ? fmtDateTime(info.at) : '記録中…'}${by ? ` · ${esc(by)}さんがチェック` : ''}</span>` : ''}
    </label>`;
  }
  return `<div class="person ${isPayer ? 'is-payer' : ''}">
    <div class="person-head">
      ${chip(m)}
      <span class="person-total">${yen(p.total)}</span>
    </div>
    <div class="muted small">${parts.join(' · ') || '負担なし'}</div>
    ${payRow}
  </div>`;
}

function utilRow(it) {
  return `<div class="util-row">
    <input name="util_label" maxlength="20" placeholder="項目名" value="${esc(it.label)}" aria-label="内訳の名前">
    <input name="util_amount" type="number" inputmode="numeric" min="0" step="1" placeholder="0"
      value="${it.amount || ''}" aria-label="${esc(it.label || '内訳')}の金額（円）">
    <button type="button" class="icon-btn" data-remove aria-label="この内訳を外す">✕</button>
  </div>`;
}

function picks(c, selected) {
  const list = state.members.filter((m) => m.active || selected.includes(m.id));
  return `<div class="picks">${list.map((m) => `
    <label class="pick" style="--c:${colorOf(m)}">
      <input type="checkbox" name="share_${c.key}" value="${m.id}" ${selected.includes(m.id) ? 'checked' : ''}>
      <span>${esc(m.name)}</span>
    </label>`).join('')}</div>`;
}

function openForm(el, bill, nights) {
  const fixedField = (c) => {
    const current = num(state.settings[SETTING_KEY[c.key]]);
    const differs = !bill._unsaved && current !== bill[c.key];
    return `<div class="fixed-amount">
        <span class="strong">${yen(bill._unsaved ? current : bill[c.key])}</span>
        <span class="muted small">毎月固定（設定画面で変更）</span>
      </div>
      ${differs ? `<label class="check small"><input type="checkbox" name="sync_${c.key}"> 設定の金額（${yen(current)}）に更新する</label>` : ''}`;
  };
  const nightsText = activeMembers()
    .map((m) => `${esc(m.name)} ${nights[m.id] || 0}泊`).join('・');

  const { dlg } = modal({
    title: `${fmtMonth(bill.month)}の金額`,
    content: `
      <label class="field">支払い者（まとめて払う人）
        <select name="payer_id" required>${memberOptions(bill.payer_id, { allowEmpty: !bill.payer_id })}</select>
      </label>
      ${CATS.map((c) => `
        <fieldset class="cat">
          <legend>${c.label} <span class="muted small">${c.rule}</span></legend>
          ${c.fixed ? fixedField(c) : c.usage ? `
            <div data-util>${bill.utility_items.map(utilRow).join('')}</div>
            <div class="util-foot">
              <button type="button" class="btn ghost small" data-add-util>＋ 内訳を追加</button>
              <span>合計 <strong data-util-total></strong></span>
            </div>` : `
            <input name="${c.key}" type="number" inputmode="numeric" min="0" step="1" placeholder="0"
              aria-label="${c.label}（円）" value="${bill[c.key] || ''}">`}
          ${c.key === 'other' ? `<input name="other_note" maxlength="40" placeholder="内容（例：Wi-Fi、消耗品）" value="${esc(bill.other_note)}">` : ''}
          ${c.usage ? `<p class="muted small">${prevLabel(bill.month)}の泊数：${nightsText || 'なし'}<br>前月の予約カレンダーから自動で計算します。</p>` : ''}
          <div class="muted small">割る人</div>
          ${picks(c, bill.shares[c.key])}
        </fieldset>`).join('')}
      <div class="preview" data-preview></div>`,
    onSubmit: async (form) => {
      const v = readForm(form, bill);
      if (!v.payer_id) {
        toast('支払い者を選んでください', 'error');
        return false;
      }
      if (v.utility_items.some((it) => !it.label)) {
        toast('光熱費の内訳の名前を入力してください', 'error');
        return false;
      }
      const empty = CATS.find((c) => v[c.key] > 0 && !v.shares[c.key].length);
      if (empty) {
        toast(`${empty.label}を割る人を1人以上選んでください`, 'error');
        return false;
      }
      await db.set('bills', bill.month, {
        month: bill.month,
        payer_id: v.payer_id,
        rent: v.rent,
        parking: v.parking,
        utilities: v.utilities,
        utility_items: v.utility_items,
        other: v.other,
        other_note: v.other_note,
        shares: v.shares,
        updated_at: serverTimestamp(),
        items: deleteField(), // 古い形式の項目を消す
        split_count: deleteField(),
      });
      toast('保存しました');
      draw(el);
    },
  });

  const form = dlg.querySelector('form');
  const preview = dlg.querySelector('[data-preview]');
  const update = () => {
    const v = readForm(form, bill);
    const { per, total } = calc(v, nights);
    const rows = state.members.filter((m) => per[m.id])
      .map((m) => `<div><span>${esc(m.name)}</span><strong>${yen(per[m.id].total)}</strong></div>`).join('');
    preview.innerHTML = `<div class="preview-title">合計 ${yen(total)}</div>${rows}`;
    dlg.querySelector('[data-util-total]').textContent = yen(v.utilities);
  };
  const utilEl = dlg.querySelector('[data-util]');
  dlg.querySelector('[data-add-util]').onclick = () => {
    utilEl.insertAdjacentHTML('beforeend', utilRow({ label: '', amount: 0 }));
    utilEl.lastElementChild.querySelector('input').focus();
    update();
  };
  utilEl.onclick = (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    btn.closest('.util-row').replaceWith();
    update();
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}

function readForm(form, bill) {
  const fixed = (key) => {
    const current = num(state.settings[SETTING_KEY[key]]);
    if (bill._unsaved) return current;
    return form[`sync_${key}`]?.checked ? current : bill[key];
  };
  const shares = Object.fromEntries(CATS.map((c) =>
    [c.key, $$(`[name=share_${c.key}]:checked`, form).map((i) => i.value)]));
  const items = $$('.util-row', form)
    .map((row) => ({
      label: row.querySelector('[name=util_label]').value.trim(),
      amount: num(row.querySelector('[name=util_amount]').value),
    }))
    .filter((it) => it.label || it.amount);
  return {
    payer_id: form.payer_id.value,
    rent: fixed('rent'),
    parking: fixed('parking'),
    utility_items: items,
    utilities: items.reduce((sum, it) => sum + it.amount, 0),
    other: num(form.other.value),
    other_note: form.other_note.value.trim(),
    shares,
  };
}
