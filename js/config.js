// =========================================================
// ここだけ自分の Firebase の値に書き換えてください。
// Firebase コンソール →（歯車）プロジェクトの設定 → マイアプリ →「SDK の設定と構成」の
// 「構成（Config）」に表示される値をそのまま貼り付けます。
// ※ apiKey は公開して大丈夫な値です（データは合言葉ログインとセキュリティルールで守られます）。
// =========================================================

export const firebaseConfig = {
  apiKey: 'YOUR-API-KEY',
  authDomain: 'YOUR-PROJECT.firebaseapp.com',
  projectId: 'YOUR-PROJECT',
  storageBucket: 'YOUR-PROJECT.appspot.com',
  messagingSenderId: '000000000000',
  appId: 'YOUR-APP-ID',
};

// 全員で共有するログイン用アカウントのメールアドレス。
// Firebase で作成したユーザーと、firestore.rules の中のアドレスに合わせてください。
export const SHARED_EMAIL = 'house@example.com';
