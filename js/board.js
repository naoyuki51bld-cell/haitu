import { db, orderBy, limit, serverTimestamp } from './db.js';
import { state, memberById, chip } from './state.js';
import { esc, linkify, fmtDateTime, modal, toast } from './util.js';

export async function renderBoard(el) {
  el.innerHTML = `
    <div class="row-end top">
      <button type="button" class="btn primary" data-new>＋ 投稿する</button>
    </div>
    <div class="posts" data-list><p class="empty">読み込み中…</p></div>`;
  el.querySelector('[data-new]').onclick = () => openForm(el, {});
  await draw(el);
}

async function draw(el) {
  const posts = await db.list('posts', orderBy('created_at', 'desc'), limit(100));
  posts.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)); // 固定を先頭に（安定ソート）
  const list = el.querySelector('[data-list]');
  list.innerHTML = posts.length ? posts.map(postHtml).join('') : `
    <div class="card empty">
      まだ投稿はありません。<br>鍵の場所、Wi-Fi、ゴミ出しのルールなどを書いておきましょう。
    </div>`;
  list.onclick = (e) => {
    const btn = e.target.closest('[data-edit]');
    if (btn) openForm(el, posts.find((p) => p.id === btn.dataset.edit));
  };
}

function postHtml(p) {
  return `<article class="card post ${p.pinned ? 'pinned' : ''}">
    <header class="post-head">
      <h3>${p.pinned ? '<span class="pin" title="固定">📌</span>' : ''}${esc(p.title)}</h3>
      <button type="button" class="btn ghost small" data-edit="${p.id}">編集</button>
    </header>
    ${p.body ? `<div class="post-body">${linkify(esc(p.body))}</div>` : ''}
    <footer class="post-foot">
      ${chip(memberById(p.member_id))}
      <time class="muted small">${fmtDateTime(p.created_at)}${p.updated_at ? '（編集済み）' : ''}</time>
    </footer>
  </article>`;
}

function openForm(el, p) {
  const isEdit = !!p.id;
  modal({
    title: isEdit ? '投稿を編集' : '新しい投稿',
    submitLabel: isEdit ? '保存' : '投稿する',
    content: `
      <label class="field">タイトル
        <input name="title" required maxlength="100" value="${esc(p.title || '')}" placeholder="例：Wi-Fiのパスワード">
      </label>
      <label class="field">内容
        <textarea name="body" rows="7" maxlength="5000" placeholder="自由に書いてください">${esc(p.body || '')}</textarea>
      </label>
      <label class="check">
        <input type="checkbox" name="pinned" ${p.pinned ? 'checked' : ''}> 一番上に固定する
      </label>`,
    danger: isEdit && {
      label: '削除',
      confirm: 'この投稿を削除しますか？',
      onClick: async () => {
        await db.remove('posts', p.id);
        toast('削除しました');
        draw(el);
      },
    },
    onSubmit: async (form) => {
      const v = new FormData(form);
      const row = {
        title: String(v.get('title')).trim(),
        body: String(v.get('body')).trim(),
        pinned: v.get('pinned') === 'on',
      };
      if (!row.title) { toast('タイトルを入力してください', 'error'); return false; }
      if (isEdit) {
        await db.update('posts', p.id, { ...row, updated_at: serverTimestamp() });
      } else {
        await db.add('posts', { ...row, member_id: state.meId });
      }
      toast(isEdit ? '更新しました' : '投稿しました');
      draw(el);
    },
  });
}
