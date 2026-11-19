# セカンドハウス管理アプリ

共同で借りている部屋を管理するためのWebアプリです。スマホのホーム画面に追加すると、普通のアプリのように使えます。

## できること

| 画面 | 内容 |
|---|---|
| 📅 予約 | カレンダーで、誰がいつ泊まるかを登録します。日程が重なると確認が出ます |
| 💴 精算 | 毎月の家賃と光熱費を入力すると、1人あたりの金額を計算します。支払い済みのチェックもできます |
| 💬 掲示板 | 鍵の場所やWi-Fi、ゴミ出しのルールなどを共有します。大事な投稿は一番上に固定できます |
| ⚙️ 設定 | メンバーの追加、家賃の初期値、いつもの支払い者、合言葉の変更 |

**ログインの流れ**：最初に合言葉を入れ、自分の名前をタップするだけです。2回目からはどちらも不要です。

---

## セットアップ手順（初回のみ・20分くらい）

### 1. Supabase（データの保存先）を用意する

1. https://supabase.com で無料アカウントを作成します（GitHubアカウントでログインできます）。
2. **New project** を押し、次のように入力します。
   - Name：好きな名前（例：`second-house`）
   - Database Password：自動生成で大丈夫です（あとで使いません）
   - Region：**Northeast Asia (Tokyo)**
3. プロジェクトができたら、左メニューの **SQL Editor** を開きます。このリポジトリの `supabase/schema.sql` の中身を全部貼り付けて **Run** を押します。

### 2. 合言葉（共有アカウント）を作る

1. 左メニュー **Authentication → Users** で **Add user → Create new user** を選びます。
2. 次のように入力します。
   - Email：`house@example.com`（このままでOK。メールは送られません）
   - Password：**メンバーで共有する合言葉**（6文字以上）
   - **Auto Confirm User** にチェックを入れます
3. **【大事】** **Authentication → Sign In / Providers**（画面によっては Settings）で **「Allow new users to sign up」をオフ**にします。
   こうしておくと、知らない人がアカウントを作れなくなります。

### 3. アプリに Supabase の情報を設定する

1. Supabase の **Project Settings → API**（または「Connect」ボタン）で、次の2つを確認します。
   - **Project URL**（`https://xxxx.supabase.co`）
   - **anon public** キー
2. `js/config.js` を開き、`SUPABASE_URL` と `SUPABASE_ANON_KEY` を書き換えてコミットします。

> anon キーは公開しても問題ない鍵です。データは「合言葉ログイン」と「RLS（データベースのアクセス制限）」で守られています。

### 4. インターネットに公開する（Vercel）

1. https://vercel.com に GitHub アカウントでログインします。
2. **Add New → Project** でこのリポジトリを選び、何も変えずに **Deploy** を押します。
3. 発行された URL（`https://xxxx.vercel.app`）をメンバーに共有します。

以降は GitHub に push するたびに自動で更新されます。

### 5. スマホのホーム画面に追加する

- **iPhone**：Safari で URL を開く → 共有ボタン → **ホーム画面に追加**
- **Android**：Chrome で URL を開く → メニュー → **ホーム画面に追加**

### 6. 使いはじめる

1. 合言葉でログインします。
2. 「メンバーを追加」で全員の名前を登録します（1人がまとめて登録すればOKです）。
3. 自分の名前をタップします。
4. **設定** で「毎月の家賃」と「いつもの支払い者」を入れておくと、毎月の入力が楽になります。

---

## よくある質問

**Q. 共有アカウントのメールアドレスを変えたい**
`js/config.js` の `SHARED_EMAIL` と、`supabase/schema.sql` の中の `house@example.com` を両方書き換え、SQL を再実行してください。

**Q. 割り勘で端数が出たら？**
1円未満は切り捨てて、端数は支払い者の負担として表示します。

**Q. メンバーが抜けたら？**
設定 → メンバー → その人の「現在のメンバー」のチェックを外します。過去の予約や投稿は残ります。

**Q. お金はかかりますか？**
Supabase も Vercel も、この規模なら無料プランで足ります。
なお Supabase の無料プランは、1週間まったく使われないとプロジェクトが一時停止します（管理画面から再開できます）。

## ファイル構成

```
index.html             画面の土台
css/style.css          デザイン
js/config.js           ★ Supabase の接続情報（ここだけ書き換える）
js/main.js             ログイン・画面切り替え
js/calendar.js         予約カレンダー
js/money.js            精算
js/board.js            掲示板
js/settings.js         設定
supabase/schema.sql    データベースの定義
```

ビルドは不要です。手元で動作確認するときは、このフォルダで `python3 -m http.server` を実行し、http://localhost:8000 を開いてください。
