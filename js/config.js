// =========================================================
// ここだけ自分の Firebase の値に書き換えてください。
// Firebase コンソール →（歯車）プロジェクトの設定 → マイアプリ →「SDK の設定と構成」の
// 「構成（Config）」に表示される値をそのまま貼り付けます。
// ※ apiKey は公開して大丈夫な値です（データは合言葉ログインとセキュリティルールで守られます）。
// =========================================================

export const firebaseConfig = {
  apiKey: 'AIzaSyBuhVnrLAvvDXieyIdS1QK4g-zxU0RHmK8',
  authDomain: 'hairy-647f6.firebaseapp.com',
  projectId: 'hairy-647f6',
  storageBucket: 'hairy-647f6.firebasestorage.app',
  messagingSenderId: '101485023883',
  appId: '1:101485023883:web:caee5be5483dd5f31d7a8e',
  measurementId: 'G-H2WHQ08X36',
};

// 全員で共有するログイン用アカウントのメールアドレス。
// Firebase で作成したユーザーと、firestore.rules の中のアドレスに合わせてください。
export const SHARED_EMAIL = 'house@example.com';
