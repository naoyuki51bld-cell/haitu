import { db, where } from './db.js';
import { state, memberById, chip, colorOf, memberOptions } from './state.js';
import {
  esc, ymd, parseYmd, addDays, firstOfMonth, daysBetween, fmtDate, modal, toast, WEEK,
} from './util.js';

// 予約は「泊まる夜」で持つ：first_night の夜 〜 last_night の夜。
// チェックアウトは last_night の翌朝。
export const nightCount = (r) => daysBetween(r.first_night, r.last_night) + 1;
const checkoutOf = (r) => ymd(addDays(parseYmd(r.last_night), 1));
const isValid = (r) => typeof r.first_night === 'string' && typeof r.last_night === 'string';

/** from〜to（どちらも含む）の夜のうち、この予約で泊まる夜の数 */
export function nightsInRange(r, from, to) {
  if (!isValid(r)) return 0;
  const a = r.first_night > from ? r.first_night : from;
  const b = r.last_night < to ? r.last_night : to;
  return a > b ? 0 : daysBetween(a, b) + 1;
}

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
      <p class="muted small cal-hint">日付をタップすると、その日の夜から予約できます。</p>
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

  const byStart = (a, b) => a.first_night.localeCompare(b.first_night);
  const [fromGrid, fromToday] = await Promise.all([
    // 表示の最初の日の朝にチェックアウトする予約も含める
    db.list('reservations', where('last_night', '>=', ymd(addDays(gridStart, -1)))),
    db.list('reservations', where('last_night', '>=', today)),
  ]);
  if (token !== drawToken) return; // 連打で古い結果が来たら捨てる
  const inGrid = fromGrid.filter((r) => isValid(r) && r.first_night <= ymd(gridEnd)).sort(byStart);
  const upcoming = fromToday.filter(isValid).sort(byStart).slice(0, 30);

  // ---- カレンダー（週ごとの行。予約バーは「泊まる日の真ん中 → 翌朝の日の真ん中」） ----
  let html = `<div class="cal-row">${WEEK.map((w, i) =>
    `<div class="cal-head ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}</div>`;

  for (let w = gridStart; w <= gridEnd; w = addDays(w, 7)) {
    const wStart = ymd(w);
    const segs = [];
    for (const r of inGrid) {
      const x0 = daysBetween(wStart, r.first_night) + 0.5;
      const x1 = daysBetween(wStart, checkoutOf(r)) + 0.5;
      if (x1 <= 0 || x0 >= 7) continue;
      segs.push({ r, a: Math.max(0, x0), b: Math.min(7, x1), openL: x0 < 0, openR: x1 > 7 });
    }
    // 重ならないように段（lane）を割り当てる
    segs.sort((p, q) => p.a - q.a || q.b - q.a - (p.b - p.a));
    const laneEnds = [];
    for (const s of segs) {
      let lane = laneEnds.findIndex((end) => end <= s.a);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = s.b;
      s.lane = lane;
    }

    let days = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(w, i);
      const s = ymd(d);
      const cls = [
        'cal-day',
        d.getMonth() !== cursor.getMonth() && 'other',
        s === today && 'today',
        i === 0 && 'sun',
        i === 6 && 'sat',
      ].filter(Boolean).join(' ');
      days += `<button type="button" class="${cls}" data-date="${s}" aria-label="${fmtDate(s)}"><span class="num">${d.getDate()}</span></button>`;
    }
    const bars = segs.map((s) => {
      const m = memberById(s.r.member_id);
      const cls = ['bar', s.openL && 'open-l', s.openR && 'open-r'].filter(Boolean).join(' ');
      const left = (s.a / 7) * 100;
      const width = ((s.b - s.a) / 7) * 100;
      return `<button type="button" class="${cls}" data-id="${s.r.id}"
        style="left:${left}%;width:${width}%;--lane:${s.lane};--c:${colorOf(m)}"
        aria-label="${esc(m?.name ?? '')} ${fmtDate(s.r.first_night)}から${nightCount(s.r)}泊">${esc(m?.name ?? '')}</button>`;
    }).join('');
    html += `<div class="cal-row cal-week" style="--lanes:${laneEnds.length}">${days}${bars}</div>`;
  }

  const cal = el.querySelector('[data-cal]');
  cal.innerHTML = html;
  cal.onclick = (e) => {
    const bar = e.target.closest('[data-id]');
    if (bar) { openForm(el, inGrid.find((r) => r.id === bar.dataset.id)); return; }
    const btn = e.target.closest('[data-date]');
    if (!btn) return;
    const s = btn.dataset.date;
    const evs = inGrid.filter((r) => r.first_night <= s && r.last_night >= s);
    if (evs.length === 0) openForm(el, { first_night: s });
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

function rangeText(r) {
  return `${fmtDate(r.first_night)}の夜から${nightCount(r)}泊`;
}

function rowHtml(r) {
  const m = memberById(r.member_id);
  return `<button type="button" class="list-row" data-id="${r.id}">
    ${chip(m)}
    <span class="grow">
      <span class="strong">${rangeText(r)}</span>
      <span class="note">${fmtDate(checkoutOf(r))}の朝まで${r.note ? ` · ${esc(r.note)}` : ''}</span>
    </span>
    <span class="chev">›</span>
  </button>`;
}

function openDay(el, s, evs) {
  const { dlg, close } = modal({
    title: `${fmtDate(s)}の夜`,
    content: `<div class="list">${evs.map(rowHtml).join('')}</div>`,
    submitLabel: 'この夜に予約を追加',
    onSubmit: () => { openForm(el, { first_night: s }); },
  });
  dlg.querySelector('.list').onclick = (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    close();
    openForm(el, evs.find((r) => r.id === row.dataset.id));
  };
}

function openForm(el, r) {
  const isEdit = !!r.id;
  const first = r.first_night || ymd(new Date());
  const nights = isEdit ? nightCount(r) : 1;
  const nightOptions = Array.from({ length: 30 }, (_, i) => i + 1)
    .map((n) => `<option value="${n}" ${n === nights ? 'selected' : ''}>${n}泊</option>`).join('');

  const { dlg } = modal({
    title: isEdit ? '予約を編集' : '予約する',
    submitLabel: isEdit ? '保存' : '予約する',
    content: `
      <label class="field">泊まる人
        <select name="member_id" required>${memberOptions(r.member_id || state.meId)}</select>
      </label>
      <div class="grid2">
        <label class="field">泊まる日（夜）<input type="date" name="first_night" required value="${first}"></label>
        <label class="field">泊数<select name="nights">${nightOptions}</select></label>
      </div>
      <p class="preview" data-range></p>
      <label class="field">メモ（任意）
        <input name="note" maxlength="200" value="${esc(r.note || '')}" placeholder="例：友人2人と行きます">
      </label>`,
    danger: isEdit && {
      label: '削除',
      confirm: 'この予約を削除しますか？',
      onClick: async () => {
        await db.remove('reservations', r.id);
        toast('予約を削除しました');
        draw(el);
      },
    },
    onSubmit: async (form) => {
      const v = Object.fromEntries(new FormData(form));
      const n = Math.max(1, Number(v.nights) || 1);
      const row = {
        member_id: v.member_id,
        first_night: v.first_night,
        last_night: ymd(addDays(parseYmd(v.first_night), n - 1)),
        note: v.note.trim() || null,
      };

      // 他の人の予約と重なっていないか確認
      const candidates = await db.list('reservations', where('last_night', '>=', row.first_night));
      const overlaps = candidates.filter((o) =>
        o.id !== r.id && isValid(o) && o.first_night <= row.last_night);
      if (overlaps.length) {
        const names = [...new Set(overlaps.map((o) => memberById(o.member_id)?.name ?? '?'))].join('さん、');
        if (!confirm(`${names}さんの予約と日程が重なっています。\nこのまま保存しますか？`)) return false;
      }

      if (isEdit) await db.update('reservations', r.id, row);
      else await db.add('reservations', row);
      toast(isEdit ? '予約を更新しました' : '予約しました');
      cursor = firstOfMonth(parseYmd(row.first_night));
      draw(el);
    },
  });

  const form = dlg.querySelector('form');
  const rangeEl = dlg.querySelector('[data-range]');
  const update = () => {
    if (!form.first_night.value) { rangeEl.textContent = ''; return; }
    const n = Number(form.nights.value) || 1;
    const out = ymd(addDays(parseYmd(form.first_night.value), n));
    rangeEl.innerHTML = `${fmtDate(form.first_night.value)}の夜 → <strong>${fmtDate(out)}の朝</strong>まで`;
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}
