<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ヤフショ画像くん</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Zen+Kaku+Gothic+New:wght@500;700&family=Roboto+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css?v=0.25.1">
<style id="modal-guarantee">
/* === モーダルの寸法・見た目を index 側で保証（外部CSSのキャッシュに依存しない） === */
.overlay{background:rgba(15,18,24,.46)!important;display:grid!important;place-items:center!important;padding:24px!important;z-index:80}
.overlay[hidden]{display:none!important}
.overlay>.mini{background:#fff!important;border:1px solid #e6e1d8!important;border-radius:18px!important;box-shadow:0 30px 80px rgba(20,24,32,.35)!important;width:100%!important;padding:28px 32px!important;max-height:90vh!important;overflow:auto!important;max-width:520px!important}
.overlay>.mini-wide{max-width:920px!important}
.overlay>.mini.modal-cat{max-width:820px!important}
.overlay>.mini.modal-status{max-width:880px!important}
.overlay>.mini.modal-col{max-width:1200px!important}
</style>
</head>
<body>

<div class="sticky-top">
  <header class="app-header">
    <div class="header-inner">
      <img class="logo-img" src="logo1.png" alt="ヤフショ画像くん">
      <div class="header-actions">
        <span class="version" id="version">v0.25.1</span>
        <button class="btn btn-ghost" id="btnManage">📄 制作予定ページ管理</button>
        <button class="btn btn-ghost" id="btnManageCats">📂 出品内容管理</button>
        <button class="btn btn-ghost" id="btnManageStatus">📋 状態管理</button>
        <button class="btn btn-ghost" id="btnCols2">📐 項目管理</button>
        <button class="btn btn-ghost" id="btnSettings">⚙️ 設定</button>
        <button class="btn btn-ghost" id="btnLog">📜 ログ</button>
        <span class="gh-progress" id="ghProgress" hidden><span class="gh-spin"></span><span id="ghText"></span></span>
        <button class="btn btn-red" id="btnSave">💾 GitHubに保存</button>
      </div>
    </div>
  </header>

  <!-- フィルタ帯 -->
  <div class="console">
  <!-- 1段目：カテゴリ系 ＋ 右側アクション -->
  <div class="frow frow-cat" id="catRow">
    <div class="pill-group" id="catPills"></div>
    <span class="spacer"></span>
    <div class="view-toggle" id="viewToggle">
      <button type="button" class="vt-btn" data-view="basic" id="vtBasic">📋 基礎情報</button>
      <button type="button" class="vt-btn on" data-view="images" id="vtImages">🖼️ 画像</button>
    </div>
    <button class="btn btn-quiet btn-sm" id="btnBulkDel">🗑 一括削除</button>
    <button class="btn btn-green-line btn-sm" id="btnAddRow">＋ 行だけ</button>
    <button class="btn btn-green" id="btnAdd">＋ 新規作成</button>
  </div>

  <!-- 2段目：ステータス ＋ 変更を保存（右上） -->
  <div class="frow frow-status">
    <div class="pill-group" id="statusRow"></div>
    <span class="spacer"></span>
    <button class="btn btn-line btn-sm" id="btnBulkEdit">✏️ 一括編集</button>
    <button class="btn btn-red btn-sm" id="btnSaveEdits" hidden>変更を保存</button>
  </div>
  </div>
</div>
<div class="table-wrap">
  <div class="table-shell">
    <div class="table-scroll">
      <table id="grid" style="display:none">
        <thead id="gridHead"></thead>
        <tbody id="gridBody"></tbody>
      </table>
    </div>
    <div class="shell-empty" id="emptyState">
      <div class="lead">まだ商品がありません</div>
      <p>「＋ 新規作成」から商品を登録すると、ここに一覧で表示されます。</p>
    </div>
  </div>
</div>

<!-- 新規作成/編集モーダル -->
<div class="overlay" id="editModal" hidden>
  <div class="sheet sheet-form">
    <div class="form-topbar">
      <h2 id="edTitle">新規作成</h2>
      <div class="topbar-actions">
        <button class="btn btn-line" data-close="editModal">キャンセル</button>
        <button class="btn btn-line" id="btnSaveStay">変更を保存</button>
        <button class="btn btn-red" id="btnSaveClose">変更を保存して閉じる</button>
      </div>
    </div>

    <div class="modal-tabs">
      <button type="button" class="mtab on" data-tab="basic">基本情報</button>
      <button type="button" class="mtab" data-tab="images">画像</button>
    </div>

    <div class="form-body">
      <!-- 基本情報タブ -->
      <div class="tab-panel" id="panel-basic">
        <div class="basic-top">
          <div class="mini-imgs">
            <div class="mini-wrap"><div class="mini-img" id="miniYahoo"></div><div class="mini-cap">Yahooメイン</div></div>
            <div class="mini-wrap"><div class="mini-img" id="miniRakuten"></div><div class="mini-cap">楽天メイン</div></div>
          </div>
          <input type="file" id="fileMiniYahoo" accept="image/*" hidden>
          <input type="file" id="fileMiniRakuten" accept="image/*" hidden>
          <div class="basic-fields">
            <div class="span-all" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <label class="fld">商品名<input type="text" id="fName" placeholder="商品名"></label>
              <label class="fld">商品コード<input type="text" id="fCode" placeholder="例：ABC-123"></label>
            </div>
            <div class="span-all" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
              <label class="fld">日付<input type="date" id="fDate"></label>
              <label class="fld">評価<input type="number" id="fRating" step="0.1" min="0" placeholder="4.2 など"></label>
              <label class="fld">制作予定ページ
                <select id="fPagePlan"></select>
              </label>
            </div>
            <div class="span-all" style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
              <div style="display:grid;gap:14px;align-content:start">
                <label class="fld">出品内容
                  <select id="fListing">
                    <option>新規出品</option>
                    <option>リニューアル-同一ページ</option>
                    <option>リニューアル-新規ページ</option>
                    <option>再登録</option>
                  </select>
                </label>
                <label class="fld">状態
                  <select id="fStatus">
                    <option>未着手</option>
                    <option>作成中</option>
                    <option>確認待ち</option>
                    <option>完了</option>
                  </select>
                </label>
              </div>
              <label class="fld">販売手法<textarea id="fMethod" rows="4" placeholder="複数行で入力できます（改行OK）"></textarea></label>
            </div>
          </div>
        </div>

        <div class="form-bottom">
          <div class="url-block">
            <div class="url-head">
              <span class="url-ttl">🔍 検索ページURL</span>
            </div>
            <div class="url-row"><input type="text" id="fSearchUrl" placeholder="https://…（検索ページのURL）"></div>
          </div>
          <div class="url-block">
            <div class="url-head">
              <span class="url-ttl"><span class="tag-badge tb-y">Y</span>ヤフショURL（メイン）</span>
              <button class="btn btn-line btn-sm" data-addurl="urlYahoo">＋ 追加</button>
            </div>
            <div class="url-list" id="urlYahoo">
              <div class="url-row"><input type="text" placeholder="https://store.shopping.yahoo.co.jp/…"><button class="url-del">×</button></div>
            </div>
          </div>
          <div class="url-block">
            <div class="url-head">
              <span class="url-ttl"><span class="tag-badge tb-r">R</span>楽天URL</span>
              <button class="btn btn-line btn-sm" data-addurl="urlRakuten">＋ 追加</button>
            </div>
            <div class="url-list" id="urlRakuten">
              <div class="url-row"><input type="text" placeholder="https://item.rakuten.co.jp/…"><button class="url-del">×</button></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 画像タブ -->
      <div class="tab-panel" id="panel-images" hidden>
        <div class="gallery-sec">
          <div class="fld-label"><span class="tag-badge tb-y">Y</span>Yahoo画像<span class="gal-hint">複数まとめて登録OK／←→で並び替え／1枚目がメイン</span></div>
          <div class="dropzone" id="dzYahoo">📤 画像をここにドラッグ＆ドロップ、またはクリックで選択（複数可）</div>
          <input type="file" id="fileYahoo" accept="image/*" multiple hidden>
          <div class="img-strip" id="stripYahoo"></div>
        </div>
        <div class="gallery-sec">
          <div class="fld-label"><span class="tag-badge tb-r">R</span>楽天画像<span class="gal-hint">複数まとめて登録OK／←→で並び替え／1枚目がメイン</span></div>
          <div class="dropzone" id="dzRakuten">📤 画像をここにドラッグ＆ドロップ、またはクリックで選択（複数可）</div>
          <input type="file" id="fileRakuten" accept="image/*" multiple hidden>
          <div class="img-strip" id="stripRakuten"></div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="overlay" id="settingsModal" hidden>
  <div class="mini">
    <h2>GitHub設定</h2>
    <p class="hint">PATを入力するだけでOK。入力情報はこのブラウザ内（localStorage）にのみ保存されます。保存・画像アップロードにはリポジトリへの書き込み権限が必要です。</p>
    <label>Personal Access Token (PAT)<input type="password" id="cfgPat" placeholder="github_pat_xxxx"></label>
    <button type="button" class="adv-toggle" id="btnAdv">▶ 詳細設定（オーナー／リポジトリ／ブランチ）</button>
    <div id="advBox" hidden>
      <label>オーナー（ユーザー名）<input type="text" id="cfgOwner" value="kaiyoshida0318"></label>
      <label>リポジトリ名<input type="text" id="cfgRepo" value="yafusho-gazo"></label>
      <label>ブランチ<input type="text" id="cfgBranch" value="main"></label>
    </div>
    <div class="acts"><span class="sp"></span><button class="btn btn-ghost" data-close="settingsModal">閉じる</button><button class="btn btn-red" id="btnSaveSettings">変更を保存</button></div>
  </div>
</div>
<div class="overlay" id="logModal" hidden>
  <div class="mini">
    <h2>📜 アプリログ</h2>
    <p class="hint">GitHub保存・画像アップロード等のログです。</p>
    <textarea readonly>[起動] ヤフショ画像くん v0.25.1</textarea>
    <div class="acts"><button class="btn btn-line" id="btnCopyLog">📋 ログをコピー</button><span class="sp"></span><button class="btn btn-ghost" data-close="logModal">閉じる</button></div>
  </div>
</div>
<div class="overlay" id="manageModal" hidden>
  <div class="mini mini-wide">
    <h2>📄 制作予定ページ管理</h2>
    <p class="hint">制作予定ページの選択肢と、マーク（色＋短い記号）を編集できます。↑↓で並び替え。表のドロップダウンに反映されます。</p>
    <div class="opt-scroll" id="optScroll">
      <div class="opt-sec">
        <div class="opt-head"><span class="fld-label">制作予定ページ</span><button type="button" class="btn btn-line btn-sm" data-addopt="pagePlan">＋ 追加</button></div>
        <div class="opt-cols"><span>マーク</span><span>色</span><span>選択肢名</span><span></span><span></span><span></span></div>
        <div id="optPage"></div>
      </div>
    </div>
    <div class="acts"><span class="sp"></span><button class="btn btn-ghost" data-close="manageModal">閉じる</button><button class="btn btn-red" id="btnSaveOpts">変更を保存</button></div>
  </div>
</div>
<div class="overlay" id="colsModal" hidden>
  <div class="mini modal-col">
    <h2>📐 項目管理</h2>
    <p class="hint">左が「表示中」、右が「非表示」の項目です。「非表示にする →」「← 表示する」で切り替え、▲▼で表示順を入れ替えできます。幅(px)・折り返し・タイトル/データの揃えも設定可能。この設定はこの端末にのみ保存されます。</p>
    <div class="col-cols">
      <div class="col-col col-col-visible">
        <div class="col-col-head">✅ 表示中</div>
        <div id="colListVisible" class="col-list"></div>
      </div>
      <div class="col-col col-col-hidden">
        <div class="col-col-head">🚫 非表示</div>
        <div id="colListHidden" class="col-list"></div>
      </div>
    </div>
    <div class="acts">
      <button class="btn btn-ghost" id="btnResetCols">🔄 デフォルトに戻す</button>
      <button class="btn btn-ghost" id="btnDragResize">↔ ドラッグで幅調整</button>
      <span class="sp"></span>
      <button class="btn btn-ghost" data-close="colsModal">閉じる</button>
    </div>
  </div>
</div>
<div class="resize-bar" id="resizeBar" hidden>
  <span class="resize-bar-text">↔ 列の境界をドラッグして幅を調整できます</span>
  <button class="btn btn-red btn-sm" id="btnResizeDone">完了</button>
</div>

<div class="overlay" id="catModal" hidden>
  <div class="mini modal-cat">
    <h2>📂 出品内容管理</h2>
    <p class="hint">出品内容（上段タブ）を管理します。並び替え・名前変更・アイコン変更・削除ができます。</p>
    <div class="cat-add-row">
      <input type="text" id="newCatLabel" placeholder="新しいカテゴリ名">
      <button class="btn btn-red" id="btnAddCat">追加</button>
    </div>
    <div id="catList" class="cat-list"></div>
    <div class="acts"><span class="sp"></span><button class="btn btn-ghost" data-close="catModal">閉じる</button></div>
  </div>
</div>
<div class="overlay" id="statusModal" hidden>
  <div class="mini modal-status">
    <h2>📋 状態管理</h2>
    <p class="hint">状態（下段タブ）を管理します。番号バッジ・並び替え・名前変更・追加・削除ができます。</p>
    <div class="cat-add-row">
      <input type="text" id="newStatusLabel" placeholder="新しいステータス名">
      <button class="btn btn-red" id="btnAddStatus">追加</button>
    </div>
    <div id="statusList" class="cat-list"></div>
    <div class="acts"><span class="sp"></span><button class="btn btn-ghost" data-close="statusModal">閉じる</button></div>
  </div>
</div>
<div id="toast" class="toast" hidden></div>
<script src="app.js?v=0.25.1"></script>
</body>
</html>
