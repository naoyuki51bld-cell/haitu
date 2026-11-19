import { sb, q } from './db.js';
import { state, memberById, chip, colorOf, memberOptions } from './state.js';
import {
  esc, ymd, parseYmd, addDays, firstOfMonth, daysBetween, fmtDate, modal, toast, WEEK,
} from './util.js';

let cursor = firstOfMonth(new Date());
let drawToken = 0;

export async function renderCalendar(el) {
  el.innerHTML = `
    <section class="card">
      <div class="month-nav">
        <button type="button" class="icon-btn" data-prev aria-label="前の月">‹</button>
        <h2 data-title></h2>
        <button type="button" class="icon-btn" data-next aria-label="次の月">›</button>
      </div>
      <div class="cal" data-cal></div>
      <div class="row-end">
        <button type="button" class="btn ghost" data-today>今月</button>
        <button type="button" class="btn primary" data-add>＋ 予約する</button>
      </div>
    </section>
    <h3 class="section-title">これからの予約</h3>
    <div class="list" data-upcoming></div>`;

  const move = (n) => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1); draw(el); };
  el.querySelector('[data-prev]').onclick = () => move(-1);
  el.querySelector('[data-next]').onclick = () => move(1);
  el.querySelector('[data-today]').onclick = () => { cursor = firstOfMonth(new Date()); draw(el); };
  el.querySelector('[data-add]').onclick = () => openForm(el, {});
  await draw(el);
}

async function draw(el) {
  const token = ++drawToken;
  el.querySelector('[data-title]').textContent = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;

  const gridStart = addDays(cursor, -cursor.getDay());
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const gridEnd = addDays(last, 6 - last.getDay());
  const today = ymd(new Date());

  const [inMonth, upcoming] = await Promise.all([
    q(sb.from('reservations').select('*')
      .lte('start_date', ymd(gridEnd)).gte('end_date', ymd(gridStart)).order('start_date')),
    q(sb.from('reservations').select('*').gte('end_date', today).order('start_date').limit(30)),
  ]);
  if (token !== drawToken) return; // 連打で古い結果が来たら捨てる

  // ---- カレンダー ----
  let html = WEEK.map((w, i) =>
    `<div class="cal-head ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('');
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    const s = ymd(d);
    const evs = inMonth.filter((r) => r.start_date <= s && r.end_date >= s);
    const cls = [
      'cal-day',
      d.getMonth() !== cursor.getMonth() && 'other',
      s === today && 'today',
      d.getDay() === 0 && 'sun',
      d.getDay() === 6 && 'sat',
    ].filter(Boolean).join(' ');
    html += `<button type="button" class="${cls}" data-date="${s}" aria-label="${fmtDate(s)} 予約${evs.length}件">
      <span class="num">${d.getDate()}</span>
      ${evs.slice(0, 3).map((r) => evBar(r, s, d)).join('')}
      ${evs.length > 3 ? `<span class="more">+${evs.length - 3}</span>` : ''}
    </button>`;
  }
  const cal = el.querySelector('[data-cal]');
  cal.innerHTML = html;
  cal.onclick = (e) => {
    const btn = e.target.closest('[data-date]');
    if (!btn) return;
    const s = btn.dataset.date;
    const evs = inMonth.filter((r) => r.start_date <= s && r.end_date >= s);
    if (evs.length === 0) openForm(el, { start_date: s });
    else openDay(el, s, evs);
  };

  // ---- これからの予約 ----
  const list = el.querySelector('[data-upcoming]');
  list.innerHTML = upcoming.length
    ? upcoming.map(rowHtml).join('')
    : '<p class="empty">予約はまだありません</p>';
  list.onclick = (e) => {
    const row = e.target.closest('[data-id]');
    if (row) openForm(el, upcoming.find((r) => r.id === row.dataset.id));
  };
}

function evBar(r, s, d) {
  const m = memberById(r.member_id);
  const showName = r.start_date === s || d.getDay() === 0;
  const cls = ['ev', r.start_date === s && 'start', r.end_date === s && 'end'].filter(Boolean).join(' ');
  return `<span class="${cls}" style="--c:${colorOf(m)}">${showName ? esc(m?.name ?? '') : '&nbsp;'}</span>`;
}

function stayLabel(r) {
  const n = daysBetween(r.start_date, r.end_date);
  return n === 0 ? '日帰り' : `${n}泊`;
}

function rowHtml(r) {
  const m = memberById(r.member_id);
  const range = r.start_date === r.end_date
    ? fmtDate(r.start_date)
    : `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`;
  return `<button type="button" class="list-row" data-id="${r.id}">
    ${chip(m)}
    <span class="grow">
      <span class="strong">${range}</span><span class="muted"> · ${stayLabel(r)}</span>
      ${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}
    </span>
    <span class="chev">›</span>
  </button>`;
}

function openDay(el, s, evs) {
  const { dlg, close } = modal({
    title: fmtDate(s),
    content: `<div class="list">${evs.map(rowHtml).join('')}</div>`,
    submitLabel: 'この日から予約する',
    onSubmit: () => { openForm(el, { start_date: s }); },
  });
  dlg.querySelector('.list').onclick = (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    close();
    openForm(el, evs.find((r) => r.id === row.dataset.id));
  };
}

/** 泊数ベースで重なりを判定（出発日と次の人の到着日が同じ日はOK） */
function nightsOverlap(a, b) {
  const end = (r) => (r.start_date === r.end_date ? ymd(addDays(parseYmd(r.start_date), 1)) : r.end_date);
  return a.start_date < end(b) && b.start_date < end(a);
}

function openForm(el, r) {
  const isEdit = !!r.id;
  const start = r.start_date || ymd(new Date());
  const end = r.end_date || ymd(addDays(parseYmd(start), 1));
  modal({
    title: isEdit ? '予約を編集' : '予約する',
    submitLabel: isEdit ? '保存' : '予約する',
    content: `
      <label class="field">泊まる人
        <select name="member_id" required>${memberOptions(r.member_id || state.meId)}</select>
      </label>
      <div class="grid2">
        <label class="field">到着日<input type="date" name="start_date" required value="${start}"></label>
        <label class="field">出発日<input type="date" name="end_date" required value="${end}"></label>
      </div>
      <label class="field">メモ（任意）
        <input name="note" maxlength="200" value="${esc(r.note || '')}" placeholder="例：友人2人と行きます">
      </label>`,
    danger: isEdit && {
      label: '削除',
      confirm: 'この予約を削除しますか？',
      onClick: async () => {
        await q(sb.from('reservations').delete().eq('id', r.id));
        toast('予約を削除しました');
        draw(el);
      },
    },
    onSubmit: async (form) => {
      const v = Object.fromEntries(new FormData(form));
      if (v.end_date < v.start_date) {
        toast('出発日は到着日と同じか、それより後にしてください', 'error');
        return false;
      }
      const row = {
        member_id: v.member_id,
        start_date: v.start_date,
        end_date: v.end_date,
        note: v.note.trim() || null,
      };

      // 他の人の予約と重なっていないか確認
      let oq = sb.from('reservations').select('*').lte('start_date', row.end_date).gte('end_date', row.start_date);
      if (isEdit) oq = oq.neq('id', r.id);
      const overlaps = (await q(oq)).filter((o) => nightsOverlap(o, row));
      if (overlaps.length) {
        const names = [...new Set(overlaps.map((o) => memberById(o.member_id)?.name ?? '?'))].join('さん、');
        if (!confirm(`${names}さんの予約と日程が重なっています。\nこのまま保存しますか？`)) return false;
      }

      if (isEdit) await q(sb.from('reservations').update(row).eq('id', r.id));
      else await q(sb.from('reservations').insert(row));
      toast(isEdit ? '予約を更新しました' : '予約しました');
      cursor = firstOfMonth(parseYmd(row.start_date));
      draw(el);
    },
  });
}
