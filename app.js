// =====================================================
// ImageGallery
// 楽天・Yahoo の自社画像を商品ごとに保管するLP制作支援ツール
// =====================================================
const APP_VERSION = 'v1.3.5';

// グローバルエラーハンドラ - エラーを画面に表示
window.addEventListener('error', (e) => {
  showFatalError(e.message + ' at ' + (e.filename||'') + ':' + (e.lineno||''));
});
window.addEventListener('unhandledrejection', (e) => {
  showFatalError('Promise rejected: ' + (e.reason?.message || e.reason));
});
function showFatalError(msg) {
  console.error('FATAL:', msg);
  let el = document.getElementById('fatalError');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatalError';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#dc2626;color:white;padding:12px 20px;font-family:monospace;font-size:12px;z-index:99999;white-space:pre-wrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);max-height:50vh;overflow-y:auto;';
    document.body && document.body.appendChild(el);
  }
  el.textContent = '⚠️ ERROR: ' + msg;
}

// ----- 設定キー -----
const LS_AUTH = 'imagegallery_auth_v1';
const LS_CURRENT_SHOP = 'imagegallery_current_shop_v1';
const LS_CURRENT_CAT = 'imagegallery_current_cat_v1';

// ----- 状態 -----
let auth = {
  pat: '',
  owner: '',
  repo: '',
  branch: 'main'
};
let shops = [];        // [{id, name, mall, shopCode, appId, accessKey}]
let currentShopId = null;
let currentCategory = 'product';  // 'product' | 'material' | 'boost'
let dataCache = {};    // {shopId: {products: [...], materials: [...], boosts: [...], shaMap: {}}}
let currentProductId = null;     // open product modal target
let currentImageId = null;       // open image detail target
let searchQuery = '';
let filterUnregistered = false;
let sortKey = 'manage';  // デフォルト: 商品管理番号
let sortDir = 'desc';    // デフォルト: 降順
const LS_SORT_KEY = 'imagegallery_sort_key_v1';
const LS_SORT_DIR = 'imagegallery_sort_dir_v1';
let filterTagIds = new Set();
let openTagPickerProductId = null;
let viewMode = 'basic';  // 'basic' (基礎情報) | 'images' (画像全体)
const LS_VIEW_MODE = 'imagegallery_view_mode_v1';

// タグ用カラーパレット
const TAG_COLORS = [
  { id: 'gray',   bg: '#e5e7eb', fg: '#374151' },
  { id: 'red',    bg: '#fecaca', fg: '#991b1b' },
  { id: 'orange', bg: '#fed7aa', fg: '#9a3412' },
  { id: 'amber',  bg: '#fde68a', fg: '#92400e' },
  { id: 'green',  bg: '#bbf7d0', fg: '#166534' },
  { id: 'teal',   bg: '#99f6e4', fg: '#115e59' },
  { id: 'blue',   bg: '#bfdbfe', fg: '#1e40af' },
  { id: 'indigo', bg: '#c7d2fe', fg: '#3730a3' },
  { id: 'purple', bg: '#e9d5ff', fg: '#6b21a8' },
  { id: 'pink',   bg: '#fbcfe8', fg: '#9d174d' }
];
let newTagSelectedColor = 'amber';

// =====================================================
// 起動
// =====================================================
window.addEventListener('DOMContentLoaded', init);

async function init() {
  loadAuth();
  loadCurrentSelections();
  bindEvents();
  renderVersion();
  // 表示モードのボタンを初期化
  document.querySelectorAll('.view-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === viewMode));
  renderShopTabs();
  await loadCurrentShopData();
  render();
}

function renderVersion() {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = APP_VERSION;
}

function loadAuth() {
  const s = localStorage.getItem(LS_AUTH);
  if (s) {
    try {
      const a = JSON.parse(s);
      auth = { ...auth, ...a };
      shops = Array.isArray(a.shops) ? a.shops : [];
    } catch (e) { console.warn('auth parse failed', e); }
  }
}

function saveAuth() {
  localStorage.setItem(LS_AUTH, JSON.stringify({ ...auth, shops }));
}

function loadCurrentSelections() {
  currentShopId = localStorage.getItem(LS_CURRENT_SHOP) || null;
  currentCategory = localStorage.getItem(LS_CURRENT_CAT) || 'product';
  viewMode = localStorage.getItem(LS_VIEW_MODE) || 'basic';
  // ソート状態を復元 (なければデフォルト)
  const savedSortKey = localStorage.getItem(LS_SORT_KEY);
  const savedSortDir = localStorage.getItem(LS_SORT_DIR);
  if (savedSortKey !== null) {
    sortKey = savedSortKey === '' ? null : savedSortKey;
  }
  if (savedSortDir) {
    sortDir = savedSortDir;
  }
  if (currentShopId && !shops.find(s => s.id === currentShopId)) {
    currentShopId = shops[0]?.id || null;
  } else if (!currentShopId && shops.length) {
    currentShopId = shops[0].id;
  }
}

function bindEvents() {
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnSyncProducts').addEventListener('click', syncProducts);
  document.getElementById('btnClearProducts').addEventListener('click', clearAllProducts);
  document.getElementById('btnTagManage').addEventListener('click', openTagManageModal);
  document.getElementById('btnAddTag').addEventListener('click', createTagFromForm);
  const saveTagEditBtn = document.getElementById('btnSaveTagEdit');
  if (saveTagEditBtn) saveTagEditBtn.addEventListener('click', saveTagEdit);
  const tagEditNameEl = document.getElementById('tagEditName');
  if (tagEditNameEl) {
    tagEditNameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveTagEdit(); }
    });
  }
  document.getElementById('newTagName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createTagFromForm(); }
  });
  document.getElementById('btnTagFilterToggle').addEventListener('click', toggleTagFilterDropdown);

  // ドキュメントクリックでドロップダウン閉じる
  document.addEventListener('click', (e) => {
    const filterWrap = document.getElementById('tagFilterWrap');
    if (filterWrap && !filterWrap.contains(e.target)) {
      document.getElementById('tagFilterDropdown').style.display = 'none';
    }
    // タグピッカーも閉じる
    if (openTagPickerProductId) {
      const picker = document.querySelector(`.tag-picker[data-pid="${openTagPickerProductId}"]`);
      if (picker && !picker.contains(e.target) && !e.target.closest(`[data-tag-picker-btn="${openTagPickerProductId}"]`)) {
        picker.remove();
        openTagPickerProductId = null;
      }
    }
  });
  document.getElementById('btnImportCsv').addEventListener('click', openCsvImportModal);
  document.getElementById('btnPickCsv').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('csvFileInput').click();
  });
  document.getElementById('csvFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleCsvFile(file);
    e.target.value = '';
  });
  // CSV dropzone
  const csvDz = document.getElementById('csvDropzone');
  csvDz.addEventListener('click', () => document.getElementById('csvFileInput').click());
  csvDz.addEventListener('dragover', (e) => {
    e.preventDefault();
    csvDz.classList.add('dragover');
  });
  csvDz.addEventListener('dragleave', () => csvDz.classList.remove('dragover'));
  csvDz.addEventListener('drop', (e) => {
    e.preventDefault();
    csvDz.classList.remove('dragover');
    const file = Array.from(e.dataTransfer.files).find(f =>
      f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv'
    );
    if (file) handleCsvFile(file);
    else toast('CSVファイルをドロップしてください', 'error');
  });
  document.getElementById('btnConfirmCsvImport').addEventListener('click', confirmCsvImport);
  document.getElementById('btnAddEntry').addEventListener('click', openEntryForm);

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    render();
  });
  document.getElementById('filterUnregistered').addEventListener('change', (e) => {
    filterUnregistered = e.target.checked;
    render();
  });

  // 表示モード切替
  document.querySelectorAll('.view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.mode;
      localStorage.setItem(LS_VIEW_MODE, viewMode);
      document.querySelectorAll('.view-mode-btn').forEach(b =>
        b.classList.toggle('active', b === btn));
      render();
    });
  });

  // Category tabs
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentCategory = btn.dataset.cat;
      localStorage.setItem(LS_CURRENT_CAT, currentCategory);
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
  });

  // Upload
  document.getElementById('btnPickFiles').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('fileInput').click();
  });
  document.getElementById('fileInput').addEventListener('change', (e) => {
    uploadFiles(Array.from(e.target.files));
    e.target.value = '';
  });

  // Drag and drop on dropzone
  const dz = document.getElementById('uploadDropzone');
  dz.addEventListener('click', () => document.getElementById('fileInput').click());
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    uploadFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
  });

  // Tag input enter
  document.getElementById('imageDetailTagInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTagFromInput();
    }
  });

  // Close modal on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target === el) el.style.display = 'none';
    });
  });
}

// =====================================================
// 画像のソート (ファイル名昇順、自然順序)
// "メイン1.jpg" < "メイン2.jpg" < "メイン10.jpg" のように扱う
// =====================================================
function getImageSortKey(img) {
  if (img.originalName) return img.originalName;
  if (img.filename) {
    // "1715000000_abc123_元のファイル名.jpg" → "元のファイル名.jpg"
    const m = img.filename.match(/^\d+_[a-z0-9]+_(.+)$/);
    return m ? m[1] : img.filename;
  }
  return '';
}

function sortImagesByName(images) {
  return images.slice().sort((a, b) => {
    const ka = getImageSortKey(a);
    const kb = getImageSortKey(b);
    return ka.localeCompare(kb, 'ja', { numeric: true, sensitivity: 'base' });
  });
}

// =====================================================
// GitHub API
// =====================================================
async function ghFetch(path, opts = {}) {
  if (!auth.pat || !auth.owner || !auth.repo) {
    throw new Error('GitHub設定が未入力です。⚙️設定から登録してください。');
  }
  const url = `https://api.github.com/repos/${auth.owner}/${auth.repo}/${path}`;
  const headers = {
    'Authorization': `token ${auth.pat}`,
    'Accept': 'application/vnd.github.v3+json',
    ...(opts.headers || {})
  };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers });
  return res;
}

function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== gallery.json の保存/読み込み =====
function shopDataPath(shopId) {
  return `data/${shopId}/gallery.json`;
}

async function loadShopData(shopId) {
  const path = shopDataPath(shopId);
  try {
    const res = await ghFetch(`contents/${path}?ref=${auth.branch}`);
    if (res.status === 404) {
      return { products: [], materials: [], boosts: [], tags: [], sha: null };
    }
    const data = await res.json();
    const json = JSON.parse(b64decode(data.content.replace(/\n/g, '')));
    let products = Array.isArray(json.products) ? json.products : [];

    // === マイグレーション (v1.1.5) ===
    // STEP 1: itemUrlから正しい管理番号を取り直す
    const shop = shops.find(s => s.id === shopId);
    if (shop && shop.shopCode) {
      products.forEach(p => {
        if (p.itemUrl) {
          const correctCode = extractCode(p.itemUrl, shop.shopCode);
          if (correctCode && correctCode !== p.itemManageNumber) {
            if (correctCode === p.itemNumber) {
              p.itemManageNumber = p.itemNumber;
              p.itemNumber = '';
            } else {
              p._oldManageNumber = p.itemManageNumber;
              p.itemManageNumber = correctCode;
            }
          }
        }
      });
    }

    // STEP 2: 同じ itemManageNumber の重複をマージ
    // (画像は全部統合、編集された商品番号・名前は古い方を優先しない=新しい方を残す)
    const mergedMap = new Map();
    let mergedCount = 0;
    products.forEach(p => {
      if (!p.itemManageNumber) {
        // 管理番号がない商品は壊れたデータとして除外
        mergedCount++;
        return;
      }
      const key = String(p.itemManageNumber).trim();
      const existing = mergedMap.get(key);
      if (!existing) {
        mergedMap.set(key, p);
      } else {
        // マージ: 画像配列をつなぐ(重複URLは除外)
        const existingUrls = new Set((existing.images || []).map(i => i.url));
        const newImages = (p.images || []).filter(i => !existingUrls.has(i.url));
        existing.images = [...(existing.images || []), ...newImages];
        // 手動入力された値があれば優先
        if (!existing.itemNumber && p.itemNumber) existing.itemNumber = p.itemNumber;
        if (!existing.itemName && p.itemName) existing.itemName = p.itemName;
        mergedCount++;
      }
    });
    if (mergedCount > 0) {
      console.log(`[ImageGallery] Merged ${mergedCount} duplicate/broken product entries`);
    }
    products = Array.from(mergedMap.values());

    return {
      products,
      materials: Array.isArray(json.materials) ? json.materials : [],
      boosts: Array.isArray(json.boosts) ? json.boosts : [],
      tags: Array.isArray(json.tags) ? json.tags : [],  // ショップのタグマスタ
      sha: data.sha,
      _mergedCount: mergedCount
    };
  } catch (e) {
    console.error('loadShopData failed', e);
    return { products: [], materials: [], boosts: [], tags: [], sha: null };
  }
}

async function saveShopData(shopId, message) {
  // 直列化: 同じショップの保存は順番に実行 + 409エラー時はSHAを取り直してリトライ
  if (!saveShopData._queues) saveShopData._queues = {};
  const prev = saveShopData._queues[shopId] || Promise.resolve();
  const next = prev.catch(() => {}).then(() => _saveShopDataOnce(shopId, message));
  saveShopData._queues[shopId] = next;
  try {
    return await next;
  } finally {
    if (saveShopData._queues[shopId] === next) {
      delete saveShopData._queues[shopId];
    }
  }
}

async function _saveShopDataOnce(shopId, message, retryCount = 0) {
  const data = dataCache[shopId];
  if (!data) return;
  const path = shopDataPath(shopId);
  const content = JSON.stringify({
    products: data.products,
    materials: data.materials,
    boosts: data.boosts,
    tags: data.tags || []
  }, null, 2);

  const body = {
    message: message || 'update gallery',
    content: b64encode(content),
    branch: auth.branch
  };
  if (data.sha) body.sha = data.sha;

  const res = await ghFetch(`contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    // SHA衝突(409 or 422)はSHAを取り直して1回だけリトライ
    if ((res.status === 409 || res.status === 422) && retryCount < 1) {
      try {
        const head = await ghFetch(`contents/${path}?ref=${auth.branch}`);
        if (head.ok) {
          const headData = await head.json();
          data.sha = headData.sha;
          return _saveShopDataOnce(shopId, message, retryCount + 1);
        }
      } catch (e) { /* fall through */ }
    }
    let errMsg = `GitHub保存失敗 (status:${res.status})`;
    try {
      const err = await res.json();
      if (err.message) errMsg = err.message;
    } catch (e) {}
    throw new Error(errMsg);
  }
  const result = await res.json();
  data.sha = result.content.sha;
}

// ===== 画像の保存/取得 =====
function imagePath(shopId, productId, filename) {
  return `data/${shopId}/images/${productId || 'common'}/${filename}`;
}

async function uploadImageToGitHub(shopId, productId, file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const safeBase = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeBase}.${ext}`;
  const path = imagePath(shopId, productId, filename);
  const content = await fileToBase64(file);

  const res = await ghFetch(`contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `upload image: ${filename}`,
      content,
      branch: auth.branch
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'アップロード失敗');
  }
  const result = await res.json();
  return {
    id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    filename,
    originalName: file.name,  // 元のファイル名(ソート用)
    path,
    sha: result.content.sha,
    url: result.content.download_url,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    note: '',
    tags: []
  };
}

async function deleteImageFromGitHub(imageMeta) {
  const res = await ghFetch(`contents/${imageMeta.path}`, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `delete image: ${imageMeta.filename}`,
      sha: imageMeta.sha,
      branch: auth.branch
    })
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.json();
    throw new Error(err.message || '削除失敗');
  }
}

// =====================================================
// 楽天 IchibaItem Search API の itemUrl から商品管理番号(code)を抽出
// 通常:        https://item.rakuten.co.jp/{shop}/{code}/
// アフィリ中継: https://hb.afl.rakuten.co.jp/.../?pc=https%3A%2F%2Fitem.rakuten.co.jp%2F{shop}%2F{code}%2F&...
// ⚠️ itemCode の ":" 以降は使ってはいけない(壊れたデータが入ることがある)
// =====================================================
function extractCode(itemUrl, shopCode) {
  if (!itemUrl || !shopCode) return null;
  try {
    let decoded = itemUrl;
    if (itemUrl.includes('hb.afl.rakuten.co.jp')) {
      const u = new URL(itemUrl);
      const pc = u.searchParams.get('pc');
      if (pc) decoded = decodeURIComponent(pc);
    }
    const shop = String(shopCode).toLowerCase();
    const m = decoded.toLowerCase().match(
      new RegExp(`item\\.rakuten\\.co\\.jp/${shop}/([^/?]+)/?`)
    );
    if (m) return m[1];
  } catch (e) { /* フォールスルー */ }
  return null;
}

// =====================================================
// 楽天 RMS 商品API (商品一覧取得)
// =====================================================
async function fetchRakutenProducts(shop) {
  // 楽天ウェブサービス 新API (2026年2月移行版)
  // エンドポイント: openapi.rakuten.co.jp
  // applicationId(UUID) + accessKey の両方が必須
  if (!shop.appId) throw new Error('Application ID(UUID)が未設定です');
  if (!shop.accessKey) throw new Error('Access Keyが未設定です');
  if (!shop.shopCode) throw new Error('shopCodeが未設定です');

  const all = [];
  const hitsPerPage = 30;
  for (let page = 1; page <= 34; page++) {  // max 34 pages = 1020 items
    const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601?applicationId=${encodeURIComponent(shop.appId)}&accessKey=${encodeURIComponent(shop.accessKey)}&shopCode=${encodeURIComponent(shop.shopCode)}&hits=${hitsPerPage}&page=${page}&format=json`;

    let retries = 0;
    while (retries < 3) {
      try {
        const res = await fetch(url);
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 1500 * (retries + 1)));
          retries++;
          continue;
        }
        const data = await res.json();
        if (data.error) throw new Error(data.error_description || data.error);
        const items = data.Items || [];
        items.forEach(it => {
          const item = it.Item;
          if (!item) return;
          // ⚠️ itemCodeの":"以降を使うのは禁止。itemUrlから正しい管理番号を取り出す
          const manageNum = extractCode(item.itemUrl, shop.shopCode);
          if (!manageNum) {
            console.warn('[ImageGallery] 管理番号抽出失敗:', item.itemUrl);
            return;  // スキップ(フォールバック禁止)
          }
          // クリーンなURL (アフィリエイト中継を剥がす)
          const cleanUrl = `https://item.rakuten.co.jp/${shop.shopCode.toLowerCase()}/${manageNum}/`;
          all.push({
            itemCode: item.itemCode,         // 参考保持のみ。管理番号判定には使わない
            itemUrl: cleanUrl,
            itemName: item.itemName,
            itemManageNumber: manageNum,
            itemPrice: item.itemPrice,
            mediumImageUrl: item.mediumImageUrls?.[0]?.imageUrl || null
          });
        });
        if (items.length < hitsPerPage) {
          return all;  // 最後のページ
        }
        break;  // 次のページへ
      } catch (e) {
        retries++;
        if (retries >= 3) throw e;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    // ページ間にもウェイト
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

// =====================================================
// タグ管理
// =====================================================
function getCurrentTags() {
  const data = dataCache[currentShopId];
  if (!data) return [];
  if (!Array.isArray(data.tags)) data.tags = [];
  return data.tags;
}
function findTag(tagId) {
  return getCurrentTags().find(t => t.id === tagId);
}
function getTagColor(colorId) {
  return TAG_COLORS.find(c => c.id === colorId) || TAG_COLORS[0];
}

function openTagManageModal() {
  if (!currentShopId) { toast('ショップが選択されていません', 'error'); return; }
  newTagSelectedColor = 'amber';
  document.getElementById('newTagName').value = '';
  renderTagColorPicker();
  renderTagManageList();
  document.getElementById('tagManageModal').style.display = 'flex';
}

function renderTagColorPicker() {
  const wrap = document.getElementById('newTagColorPicker');
  wrap.innerHTML = TAG_COLORS.map(c => `
    <div class="color-swatch ${c.id === newTagSelectedColor ? 'selected' : ''}"
         data-color="${c.id}"
         style="background:${c.bg};color:${c.fg}"
         title="${c.id}">●</div>
  `).join('');
  wrap.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      newTagSelectedColor = el.dataset.color;
      renderTagColorPicker();
    });
  });
}

function renderTagManageList() {
  const wrap = document.getElementById('tagManageList');
  const tags = getCurrentTags();
  if (tags.length === 0) {
    wrap.innerHTML = '<div class="tag-manage-empty">まだタグがありません。下のフォームから追加してください。</div>';
    return;
  }
  wrap.innerHTML = tags.map(t => {
    const c = getTagColor(t.color);
    const usedCount = countTagUsage(t.id);
    return `<div class="tag-manage-row">
      <span class="tag-chip" style="background:${c.bg};color:${c.fg}">${escapeHtml(t.name)}</span>
      <span class="tag-used-count">${usedCount}件で使用中</span>
      <div class="tag-manage-actions">
        <button class="btn-icon-mini" data-edit-tag="${t.id}">編集</button>
        <button class="btn-icon-mini danger" data-del-tag="${t.id}">削除</button>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-edit-tag]').forEach(b =>
    b.addEventListener('click', () => editTag(b.dataset.editTag)));
  wrap.querySelectorAll('[data-del-tag]').forEach(b =>
    b.addEventListener('click', () => deleteTag(b.dataset.delTag)));
}

function countTagUsage(tagId) {
  const data = dataCache[currentShopId];
  if (!data) return 0;
  return data.products.filter(p => (p.tagIds || []).includes(tagId)).length;
}

async function createTagFromForm() {
  const input = document.getElementById('newTagName');
  const name = input.value.trim();
  if (!name) { toast('タグ名を入力してください', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data.tags) data.tags = [];
  if (data.tags.some(t => t.name === name)) {
    toast('同じ名前のタグが既にあります', 'error'); return;
  }
  const newTag = {
    id: 'tag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name,
    color: newTagSelectedColor,
    createdAt: new Date().toISOString()
  };
  data.tags.push(newTag);
  showLoading('タグを保存中...');
  try {
    await saveShopData(currentShopId, `add tag: ${name}`);
    hideLoading();
    input.value = '';
    renderTagManageList();
    renderTagFilterDropdown();
    render();
    toast(`タグ「${name}」を追加しました`, 'success');
  } catch (e) {
    hideLoading();
    data.tags.pop();
    toast('保存失敗: ' + e.message, 'error');
  }
}

let editingTagSelectedColor = 'amber';

function editTag(tagId) {
  try {
    const tag = findTag(tagId);
    if (!tag) { toast('タグが見つかりません', 'error'); return; }

    const modal = document.getElementById('tagEditModal');
    const idEl = document.getElementById('tagEditId');
    const nameEl = document.getElementById('tagEditName');
    const colorPicker = document.getElementById('tagEditColorPicker');

    // モーダル要素が無い場合のフォールバック (HTMLが古い場合)
    if (!modal || !idEl || !nameEl || !colorPicker) {
      console.error('[ImageGallery] tagEditModal要素が見つかりません。HTMLを最新版に差し替えてください。');
      // promptでの簡易編集にフォールバック
      const newName = prompt('タグ名を変更 (HTMLが古いため簡易モード):', tag.name);
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) { toast('タグ名は空にできません', 'error'); return; }
      const data = dataCache[currentShopId];
      if (data.tags.some(t => t.id !== tagId && t.name === trimmed)) {
        toast('同じ名前のタグが既にあります', 'error'); return;
      }
      const old = tag.name;
      tag.name = trimmed;
      showLoading('保存中...');
      saveShopData(currentShopId, `rename tag: ${old} -> ${trimmed}`)
        .then(() => {
          hideLoading();
          renderTagManageList();
          renderTagFilterDropdown();
          render();
          toast('タグ名を更新しました(色変更にはHTMLの差し替えが必要)', 'success');
        })
        .catch(e => {
          tag.name = old;
          hideLoading();
          toast('保存失敗: ' + e.message, 'error');
        });
      return;
    }

    idEl.value = tag.id;
    nameEl.value = tag.name;
    editingTagSelectedColor = tag.color || 'amber';
    renderTagEditColorPicker();
    modal.style.display = 'flex';
  } catch (e) {
    console.error('[ImageGallery] editTag failed:', e);
    toast('編集モーダルを開けません: ' + e.message, 'error');
  }
}

function renderTagEditColorPicker() {
  const wrap = document.getElementById('tagEditColorPicker');
  wrap.innerHTML = TAG_COLORS.map(c => `
    <div class="color-swatch ${c.id === editingTagSelectedColor ? 'selected' : ''}"
         data-color="${c.id}"
         style="background:${c.bg};color:${c.fg}"
         title="${c.id}">●</div>
  `).join('');
  wrap.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      editingTagSelectedColor = el.dataset.color;
      renderTagEditColorPicker();
    });
  });
}

async function saveTagEdit() {
  const id = document.getElementById('tagEditId').value;
  const tag = findTag(id);
  if (!tag) { toast('タグが見つかりません', 'error'); return; }
  const newName = document.getElementById('tagEditName').value.trim();
  if (!newName) { toast('タグ名は空にできません', 'error'); return; }

  const data = dataCache[currentShopId];
  if (data.tags.some(t => t.id !== id && t.name === newName)) {
    toast('同じ名前のタグが既にあります', 'error'); return;
  }

  const oldName = tag.name;
  const oldColor = tag.color;
  tag.name = newName;
  tag.color = editingTagSelectedColor;

  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `edit tag: ${oldName} -> ${newName}`);
    hideLoading();
    closeModal('tagEditModal');
    renderTagManageList();
    renderTagFilterDropdown();
    render();
    toast('タグを更新しました', 'success');
  } catch (e) {
    // ロールバック
    tag.name = oldName;
    tag.color = oldColor;
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

async function deleteTag(tagId) {
  const tag = findTag(tagId);
  if (!tag) return;
  const usage = countTagUsage(tagId);
  const msg = usage > 0
    ? `タグ「${tag.name}」を削除します。\n${usage}件の商品からも自動で外されます。\n続行しますか?`
    : `タグ「${tag.name}」を削除します。続行しますか?`;
  if (!confirm(msg)) return;
  const data = dataCache[currentShopId];
  const tagIndex = data.tags.findIndex(t => t.id === tagId);
  if (tagIndex < 0) return;
  data.products.forEach(p => {
    if (Array.isArray(p.tagIds)) {
      p.tagIds = p.tagIds.filter(id => id !== tagId);
    }
  });
  const removed = data.tags.splice(tagIndex, 1)[0];
  filterTagIds.delete(tagId);
  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `delete tag: ${tag.name}`);
    hideLoading();
    renderTagManageList();
    renderTagFilterDropdown();
    render();
    toast('タグを削除しました', 'success');
  } catch (e) {
    data.tags.splice(tagIndex, 0, removed);
    hideLoading();
    toast('削除失敗: ' + e.message, 'error');
  }
}

function toggleTagFilterDropdown() {
  const dd = document.getElementById('tagFilterDropdown');
  if (dd.style.display === 'none') {
    renderTagFilterDropdown();
    dd.style.display = 'block';
  } else {
    dd.style.display = 'none';
  }
}

function renderTagFilterDropdown() {
  const dd = document.getElementById('tagFilterDropdown');
  const tags = getCurrentTags();
  if (tags.length === 0) {
    dd.innerHTML = '<div class="tag-filter-empty">タグがまだありません。<br>🏷️タグ管理から追加してください</div>';
    return;
  }
  const allBtn = filterTagIds.size > 0
    ? '<button class="tag-filter-clear" id="btnClearTagFilter">フィルタをクリア</button>'
    : '';
  dd.innerHTML = `
    ${allBtn}
    <div class="tag-filter-list">
      ${tags.map(t => {
        const c = getTagColor(t.color);
        const active = filterTagIds.has(t.id);
        return `<label class="tag-filter-item ${active ? 'active' : ''}">
          <input type="checkbox" data-filter-tag="${t.id}" ${active ? 'checked' : ''}>
          <span class="tag-chip" style="background:${c.bg};color:${c.fg}">${escapeHtml(t.name)}</span>
        </label>`;
      }).join('')}
    </div>
  `;
  dd.querySelectorAll('[data-filter-tag]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.filterTag;
      if (cb.checked) filterTagIds.add(id);
      else filterTagIds.delete(id);
      updateTagFilterIndicator();
      render();
    });
  });
  const clearBtn = document.getElementById('btnClearTagFilter');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      filterTagIds.clear();
      renderTagFilterDropdown();
      updateTagFilterIndicator();
      render();
    });
  }
}

function updateTagFilterIndicator() {
  const c = document.getElementById('tagFilterCount');
  if (!c) return;
  c.textContent = filterTagIds.size > 0 ? `(${filterTagIds.size})` : '';
  const btn = document.getElementById('btnTagFilterToggle');
  if (btn) btn.classList.toggle('active', filterTagIds.size > 0);
}

function toggleProductTagPicker(productId, anchorEl) {
  document.querySelectorAll('.tag-picker').forEach(el => el.remove());
  if (openTagPickerProductId === productId) {
    openTagPickerProductId = null;
    return;
  }
  openTagPickerProductId = productId;
  const tags = getCurrentTags();
  const data = dataCache[currentShopId];
  const p = data.products.find(x => x.id === productId);
  if (!p) return;
  if (!p.tagIds) p.tagIds = [];

  const picker = document.createElement('div');
  picker.className = 'tag-picker';
  picker.dataset.pid = productId;
  if (tags.length === 0) {
    picker.innerHTML = '<div class="tag-picker-empty">タグがありません。<br>🏷️タグ管理から追加してください</div>';
  } else {
    picker.innerHTML = tags.map(t => {
      const c = getTagColor(t.color);
      const has = p.tagIds.includes(t.id);
      return `<div class="tag-picker-item ${has ? 'selected' : ''}" data-tag-id="${t.id}">
        <span class="tag-picker-check">${has ? '✓' : ''}</span>
        <span class="tag-chip" style="background:${c.bg};color:${c.fg}">${escapeHtml(t.name)}</span>
      </div>`;
    }).join('');
  }

  const rect = anchorEl.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);

  picker.querySelectorAll('[data-tag-id]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tid = el.dataset.tagId;
      const hasIt = p.tagIds.includes(tid);
      if (hasIt) {
        p.tagIds = p.tagIds.filter(x => x !== tid);
      } else {
        p.tagIds.push(tid);
      }
      // UI即時反映 (チェックマーク&選択状態)
      el.classList.toggle('selected');
      const checkEl = el.querySelector('.tag-picker-check');
      if (checkEl) checkEl.textContent = hasIt ? '' : '✓';
      try {
        await saveShopData(currentShopId, `update tags: ${p.itemManageNumber || p.id}`);
        // 商品行のタグチップだけ再描画(ピッカーは閉じない)
        renderSingleProductRowTags(p.id);
      } catch (err) {
        // ロールバック
        if (hasIt) p.tagIds.push(tid);
        else p.tagIds = p.tagIds.filter(x => x !== tid);
        el.classList.toggle('selected');
        if (checkEl) checkEl.textContent = hasIt ? '✓' : '';
        toast('保存失敗: ' + err.message, 'error');
      }
    });
  });
}

// 指定商品のタグチップ部分だけ再描画(ピッカーを閉じずに更新)
function renderSingleProductRowTags(productId) {
  const data = dataCache[currentShopId];
  if (!data) return;
  const p = data.products.find(x => x.id === productId);
  if (!p) return;
  const row = document.querySelector(`[data-tag-picker-btn="${productId}"]`)?.closest('.product-row');
  if (!row) return;
  const tagsWrap = row.querySelector('.product-row-tags');
  if (!tagsWrap) return;

  const tagIds = p.tagIds || [];
  const allTags = getCurrentTags();
  const productTags = tagIds.map(id => allTags.find(t => t.id === id)).filter(Boolean);
  const tagChipsHTML = productTags.map(t => {
    const c = getTagColor(t.color);
    return `<span class="tag-chip" style="background:${c.bg};color:${c.fg}">${escapeHtml(t.name)}</span>`;
  }).join('');
  const addBtnHTML = `<button class="btn-tag-add" data-tag-picker-btn="${p.id}" title="タグを追加">🏷️ +タグ</button>`;
  tagsWrap.innerHTML = tagChipsHTML + addBtnHTML;

  // 再バインド
  tagsWrap.querySelector('[data-tag-picker-btn]').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleProductTagPicker(productId, e.currentTarget);
  });
}

async function clearAllProducts() {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) return;
  const count = data.products.length;
  if (count === 0) { toast('クリア対象の商品がありません', 'error'); return; }

  if (!confirm(`「${shop.name}」の商品データを全てクリアします。\n\n対象: ${count}件の商品(画像紐づけも含む)\n※ 既にアップロードされた画像ファイル自体はGitHub上に残ります\n\n本当に実行しますか?`)) return;
  if (!confirm(`もう一度確認: ${count}件の商品データを削除します。元に戻せません。続行しますか?`)) return;

  showLoading('商品データをクリア中...');
  try {
    data.products = [];
    await saveShopData(currentShopId, `clear all products (${count} items)`);
    hideLoading();
    toast(`${count}件の商品データを削除しました`, 'success');
    render();
  } catch (e) {
    hideLoading();
    toast('クリア失敗: ' + e.message, 'error');
  }
}

async function syncProducts() {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  if (!shop.appId) { toast('Application IDを設定してください', 'error'); return; }

  showLoading('商品一覧を取得中...');
  try {
    const items = await fetchRakutenProducts(shop);
    showLoading(`${items.length}件の商品を取得しました。保存中...`);

    const data = dataCache[shop.id];
    const existing = data.products;
    // 管理番号ベースで既存商品をインデックス(主キー)
    const existingByManage = new Map();
    existing.forEach(p => {
      if (p.itemManageNumber) existingByManage.set(p.itemManageNumber, p);
    });

    let added = 0;
    items.forEach(it => {
      const existingProduct = existingByManage.get(it.itemManageNumber);
      if (existingProduct) {
        // 既存の商品は商品名のみ更新 (画像データ・itemNumber編集は保持)
        existingProduct.itemName = it.itemName;
        existingProduct.itemUrl = it.itemUrl;
        existingProduct.itemPrice = it.itemPrice;
        existingProduct.rakutenThumb = it.mediumImageUrl;
        existingProduct.itemCode = it.itemCode;
      } else {
        // 新商品
        data.products.push({
          id: 'prod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          itemCode: it.itemCode,
          itemManageNumber: it.itemManageNumber,
          itemNumber: '',
          itemUrl: it.itemUrl,
          itemName: it.itemName,
          itemPrice: it.itemPrice,
          rakutenThumb: it.mediumImageUrl,
          images: [],
          syncedAt: new Date().toISOString()
        });
        added++;
      }
    });

    await saveShopData(shop.id, `sync products: +${added} new`);
    hideLoading();
    toast(`商品同期完了: 新規${added}件、合計${data.products.length}件`, 'success');
    render();
  } catch (e) {
    hideLoading();
    toast('同期失敗: ' + e.message, 'error');
    console.error(e);
  }
}

// =====================================================
// CSVインポート (商品名称一括更新)
// =====================================================
let pendingCsvImport = null;

function parseCsv(text) {
  // BOM除去
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return { headers: [], rows: [] };

  // 簡易CSVパーサ (ダブルクォート対応)
  const parseLine = (line) => {
    const result = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuote) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuote = false;
        else cur += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === ',') { result.push(cur); cur = ''; }
        else cur += c;
      }
    }
    result.push(cur);
    return result;
  };

  const headers = parseLine(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function openCsvImportModal() {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) { toast('データ未読み込みです', 'error'); return; }

  // 状態リセット
  pendingCsvImport = null;
  document.getElementById('csvImportSummary').innerHTML = '';
  document.getElementById('csvImportPreview').innerHTML = '';
  document.getElementById('btnConfirmCsvImport').style.display = 'none';
  document.getElementById('csvDropzone').style.display = 'flex';
  document.getElementById('csvImportModal').style.display = 'flex';
}

async function handleCsvFile(file) {
  const shop = getCurrentShop();
  if (!shop) { toast('ショップが選択されていません', 'error'); return; }
  const data = dataCache[currentShopId];
  if (!data) { toast('データ未読み込みです', 'error'); return; }

  // CSVモーダルが閉じていれば開く
  if (document.getElementById('csvImportModal').style.display === 'none') {
    openCsvImportModal();
  }

  try {
    const text = await file.text();
    const { headers, rows } = parseCsv(text);

    // 必須カラム検出
    const idxManage = headers.findIndex(h => h.includes('商品管理番号') || h.toLowerCase() === 'managenumber');
    const idxNumber = headers.findIndex(h => h.includes('商品番号') && !h.includes('管理'));
    const idxName = headers.findIndex(h => h.includes('商品名') || h.toLowerCase() === 'name');

    if (idxManage < 0) {
      toast('CSVに「商品管理番号」列がありません', 'error');
      return;
    }

    // 既存商品を管理番号でインデックス (寛容マッチ用に複数キーで登録)
    const productsByManage = new Map();
    data.products.forEach(p => {
      if (p.itemManageNumber) {
        const key = String(p.itemManageNumber).trim();
        productsByManage.set(key, p);
        // 全角→半角変換キーも登録
        const halfwidth = key.replace(/[\uFF10-\uFF19]/g, c =>
          String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
        );
        if (halfwidth !== key) productsByManage.set(halfwidth, p);
      }
    });

    const result = {
      total: rows.length,
      updated: 0,
      notFound: 0,
      noChange: 0,
      changes: [],
      notFoundList: [],
      debug: null
    };

    rows.forEach(row => {
      let manage = (row[idxManage] || '').trim();
      if (!manage) return;
      const newNumber = idxNumber >= 0 ? (row[idxNumber] || '').trim() : null;
      const newName = idxName >= 0 ? (row[idxName] || '').trim() : null;

      // 全角→半角に正規化
      manage = manage.replace(/[\uFF10-\uFF19]/g, c =>
        String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
      );

      const p = productsByManage.get(manage);
      if (!p) {
        result.notFound++;
        result.notFoundList.push({ manage, name: newName });
        return;
      }
      const oldNumber = p.itemNumber || '';
      const oldName = p.itemName || '';
      const changedNumber = newNumber !== null && newNumber !== oldNumber;
      const changedName = newName !== null && newName !== oldName;
      if (changedNumber || changedName) {
        result.updated++;
        result.changes.push({
          product: p,
          newNumber: changedNumber ? newNumber : null,
          newName: changedName ? newName : null,
          oldNumber, oldName
        });
      } else {
        result.noChange++;
      }
    });

    // 未マッチが多い場合のデバッグ情報を作る
    if (result.notFound > 0 && data.products.length > 0) {
      const sampleProductKeys = data.products.slice(0, 5).map(p => ({
        itemManageNumber: JSON.stringify(p.itemManageNumber),
        length: p.itemManageNumber ? p.itemManageNumber.length : 0,
        itemUrl: p.itemUrl || '',
      }));
      const sampleCsvKeys = result.notFoundList.slice(0, 5).map(nf => ({
        manage: JSON.stringify(nf.manage),
        length: nf.manage.length
      }));
      result.debug = {
        productCount: data.products.length,
        productSample: sampleProductKeys,
        csvSample: sampleCsvKeys,
        // 10001208 でのテストマッチ
        specificTest: (() => {
          const target = '10001208';
          const hit = productsByManage.get(target);
          return {
            target,
            inMap: !!hit,
            mapSize: productsByManage.size,
            sampleMapKeys: Array.from(productsByManage.keys()).slice(0, 10)
          };
        })()
      };
    }

    pendingCsvImport = result;
    showCsvImportPreview(result);
  } catch (e) {
    console.error(e);
    toast('CSV読み込み失敗: ' + e.message, 'error');
  }
}

function showCsvImportPreview(result) {
  // ドロップゾーンを隠してプレビュー表示
  document.getElementById('csvDropzone').style.display = 'none';
  const confirmBtn = document.getElementById('btnConfirmCsvImport');
  confirmBtn.style.display = '';

  const summary = document.getElementById('csvImportSummary');
  summary.innerHTML = `
    <div class="csv-stats">
      <div class="csv-stat"><div class="csv-stat-num">${result.total}</div><div class="csv-stat-label">CSV行数</div></div>
      <div class="csv-stat csv-stat-ok"><div class="csv-stat-num">${result.updated}</div><div class="csv-stat-label">更新対象</div></div>
      <div class="csv-stat"><div class="csv-stat-num">${result.noChange}</div><div class="csv-stat-label">変更なし</div></div>
      <div class="csv-stat csv-stat-warn"><div class="csv-stat-num">${result.notFound}</div><div class="csv-stat-label">未マッチ</div></div>
    </div>
  `;

  const preview = document.getElementById('csvImportPreview');
  if (result.updated === 0 && result.notFound === 0) {
    preview.innerHTML = '<div class="csv-empty">すべての商品が最新の状態です ✨</div>';
    document.getElementById('btnConfirmCsvImport').disabled = true;
  } else {
    document.getElementById('btnConfirmCsvImport').disabled = result.updated === 0;
    let html = '';
    if (result.updated > 0) {
      html += '<h4 class="csv-h">更新される商品 (' + result.updated + '件)</h4>';
      html += '<div class="csv-change-list">';
      result.changes.slice(0, 50).forEach(c => {
        html += '<div class="csv-change">';
        html += `<div class="csv-change-manage">${escapeHtml(c.product.itemManageNumber)}</div>`;
        html += '<div class="csv-change-detail">';
        if (c.newNumber !== null) {
          html += `<div class="csv-diff"><span class="csv-label">商品番号</span><span class="csv-old">${escapeHtml(c.oldNumber || '—')}</span> → <span class="csv-new">${escapeHtml(c.newNumber)}</span></div>`;
        }
        if (c.newName !== null) {
          html += `<div class="csv-diff"><span class="csv-label">商品名</span><span class="csv-old">${escapeHtml(c.oldName || '—')}</span> → <span class="csv-new">${escapeHtml(c.newName)}</span></div>`;
        }
        html += '</div></div>';
      });
      if (result.changes.length > 50) {
        html += `<div class="csv-more">…他 ${result.changes.length - 50} 件</div>`;
      }
      html += '</div>';
    }
    if (result.notFound > 0) {
      html += '<h4 class="csv-h csv-h-warn">CSVにあるがツールに未登録 (' + result.notFound + '件)</h4>';
      html += '<div class="csv-notfound-list">';
      result.notFoundList.slice(0, 20).forEach(nf => {
        html += `<div class="csv-notfound">${escapeHtml(nf.manage)} ${nf.name ? '— ' + escapeHtml(nf.name) : ''}</div>`;
      });
      if (result.notFoundList.length > 20) {
        html += `<div class="csv-more">…他 ${result.notFoundList.length - 20} 件</div>`;
      }
      html += '</div>';
      html += '<div class="csv-hint">💡 これらの商品は、楽天で商品同期を実行してから再度CSVをインポートしてください</div>';

      // デバッグ情報
      if (result.debug) {
        html += '<details class="csv-debug"><summary>🔍 デバッグ情報 (開く)</summary>';
        html += '<pre class="csv-debug-pre">' + escapeHtml(JSON.stringify(result.debug, null, 2)) + '</pre>';
        html += '</details>';
      }
    }
    preview.innerHTML = html;
  }

  document.getElementById('csvImportModal').style.display = 'flex';
}

async function confirmCsvImport() {
  if (!pendingCsvImport || pendingCsvImport.updated === 0) return;
  showLoading(`${pendingCsvImport.updated}件の商品を更新中...`);
  try {
    pendingCsvImport.changes.forEach(c => {
      if (c.newNumber !== null) c.product.itemNumber = c.newNumber;
      if (c.newName !== null) c.product.itemName = c.newName;
    });
    await saveShopData(currentShopId, `bulk update from CSV: ${pendingCsvImport.updated} items`);
    hideLoading();
    closeModal('csvImportModal');
    toast(`${pendingCsvImport.updated}件を更新しました`, 'success');
    pendingCsvImport = null;
    render();
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

// =====================================================
// ショップ管理
// =====================================================
function getCurrentShop() {
  return shops.find(s => s.id === currentShopId) || null;
}

function renderShopTabs() {
  const wrap = document.getElementById('shopTabs');
  wrap.innerHTML = '';
  shops.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'shop-tab' + (s.id === currentShopId ? ' active' : '');
    btn.textContent = s.name;
    btn.addEventListener('click', () => switchShop(s.id));
    wrap.appendChild(btn);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'shop-tab-add';
  addBtn.textContent = '+ ショップ';
  addBtn.addEventListener('click', () => openShopForm());
  wrap.appendChild(addBtn);
}

async function switchShop(shopId) {
  currentShopId = shopId;
  localStorage.setItem(LS_CURRENT_SHOP, shopId);
  renderShopTabs();
  await loadCurrentShopData();
  render();
}

async function loadCurrentShopData() {
  if (!currentShopId) return;
  if (!auth.pat || !auth.owner || !auth.repo) return;
  if (dataCache[currentShopId]) return;
  showLoading('データを読み込み中...');
  try {
    dataCache[currentShopId] = await loadShopData(currentShopId);
    // マイグレーションでマージが発生した場合は自動保存
    const merged = dataCache[currentShopId]._mergedCount || 0;
    if (merged > 0) {
      hideLoading();
      showLoading(`重複した${merged}件をマージ中...`);
      try {
        await saveShopData(currentShopId, `cleanup: merge ${merged} duplicates`);
        toast(`重複データ${merged}件を自動マージしました`, 'success');
      } catch (e) {
        console.warn('Auto-merge save failed', e);
      }
    }
  } catch (e) {
    toast('読み込み失敗: ' + e.message, 'error');
    dataCache[currentShopId] = { products: [], materials: [], boosts: [], tags: [], sha: null };
  }
  hideLoading();
}

// =====================================================
// 描画
// =====================================================
function render() {
  updateTagFilterIndicator();
  const shop = getCurrentShop();
  const empty = document.getElementById('emptyState');
  const content = document.getElementById('content');

  if (!shop) {
    empty.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  content.style.display = 'block';

  const data = dataCache[currentShopId] || { products: [], materials: [], boosts: [] };

  if (currentCategory === 'product') {
    renderProductGrid(data.products);
  } else if (currentCategory === 'material') {
    renderMaterialGrid(data.materials);
  } else if (currentCategory === 'boost') {
    renderMaterialGrid(data.boosts);
  }

  updateCategoryMeta(data);
}

function updateCategoryMeta(data) {
  const meta = document.getElementById('unregisteredCount');
  if (currentCategory === 'product') {
    const empty = data.products.filter(p => !p.images || p.images.length === 0).length;
    meta.innerHTML = empty > 0
      ? `<span class="badge-warning">📷 未登録: ${empty}件</span>`
      : `<span>全商品に画像登録済み 🎉</span>`;
  } else {
    meta.textContent = '';
  }
}

function renderProductGrid(products) {
  const content = document.getElementById('content');
  let list = products.slice();
  if (searchQuery) {
    list = list.filter(p =>
      (p.itemName || '').toLowerCase().includes(searchQuery) ||
      (p.itemCode || '').toLowerCase().includes(searchQuery) ||
      (p.itemNumber || '').toLowerCase().includes(searchQuery) ||
      (p.itemManageNumber || '').toLowerCase().includes(searchQuery)
    );
  }
  if (filterUnregistered) {
    list = list.filter(p => !p.images || p.images.length === 0);
  }
  // タグフィルタ (OR: 選択タグのいずれかを持っていればOK)
  if (filterTagIds.size > 0) {
    list = list.filter(p => {
      const ids = p.tagIds || [];
      return ids.some(id => filterTagIds.has(id));
    });
  }

  // === ソート ===
  if (sortKey) {
    const dir = sortDir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      const av = (sortKey === 'manage' ? a.itemManageNumber : a.itemNumber) || '';
      const bv = (sortKey === 'manage' ? b.itemManageNumber : b.itemNumber) || '';
      // 空欄は常に末尾
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      // 数字のみなら数値比較、それ以外は文字列比較
      const aNum = /^\d+$/.test(av);
      const bNum = /^\d+$/.test(bv);
      if (aNum && bNum) return (parseInt(av) - parseInt(bv)) * dir;
      return av.localeCompare(bv, 'ja') * dir;
    });
  }

  if (list.length === 0) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📦</div>
      <div class="empty-title">${products.length === 0 ? '商品データがありません' : '該当する商品がありません'}</div>
      <div class="empty-desc">${products.length === 0 ? '右上の「商品同期」を押して楽天から商品を取り込んでください' : '検索条件を変えてみてください'}</div>
    </div>`;
    return;
  }

  const sortIndicator = (key) => {
    if (sortKey !== key) return '<span class="sort-indicator">⇅</span>';
    return sortDir === 'asc'
      ? '<span class="sort-indicator active">▲</span>'
      : '<span class="sort-indicator active">▼</span>';
  };

  let headerHTML;
  if (viewMode === 'images') {
    // 画像全体モード: 商品番号・画像・タグ操作
    headerHTML = `
      <div class="product-table-header mode-images">
        <div class="col-number sortable" data-sort="number">商品番号 ${sortIndicator('number')}</div>
        <div class="col-images">画像</div>
        <div class="col-actions">タグ・操作</div>
      </div>
    `;
  } else {
    // 基礎情報モード: 管理番号・商品番号・商品名・画像5枚・タグ操作
    headerHTML = `
      <div class="product-table-header mode-basic">
        <div class="col-manage sortable" data-sort="manage">商品管理番号 ${sortIndicator('manage')}</div>
        <div class="col-number sortable" data-sort="number">商品番号 ${sortIndicator('number')}</div>
        <div class="col-name">商品名</div>
        <div class="col-images">画像 (最大5枚)</div>
        <div class="col-actions">タグ・操作</div>
      </div>
    `;
  }

  const html = `
    <div class="product-table">
      ${headerHTML}
      ${list.map(p => productRowHTML(p)).join('')}
    </div>
  `;
  content.innerHTML = html;

  // ソート切替
  content.querySelectorAll('[data-sort]').forEach(el => {
    el.addEventListener('click', () => toggleSort(el.dataset.sort));
  });
  // 編集ボタン
  content.querySelectorAll('[data-edit-product]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProductEditForm(btn.dataset.editProduct);
    });
  });
  // タグ追加ボタン
  content.querySelectorAll('[data-tag-picker-btn]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleProductTagPicker(btn.dataset.tagPickerBtn, btn);
    });
  });
  // 画像追加ボタン
  content.querySelectorAll('[data-add-img]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProductModal(btn.dataset.addImg);
    });
  });
  // 画像クリック → 商品モーダル開く
  content.querySelectorAll('[data-open-product]').forEach(el => {
    el.addEventListener('click', () => openProductModal(el.dataset.openProduct));
  });
}

function toggleSort(key) {
  if (sortKey !== key) {
    sortKey = key;
    sortDir = 'asc';
  } else if (sortDir === 'asc') {
    sortDir = 'desc';
  } else {
    sortKey = null;
    sortDir = 'asc';
  }
  // localStorageに保存
  localStorage.setItem(LS_SORT_KEY, sortKey === null ? '' : sortKey);
  localStorage.setItem(LS_SORT_DIR, sortDir);
  render();
}

function productRowHTML(p) {
  const imgCount = (p.images || []).length;
  const isEmpty = imgCount === 0;
  const manage = p.itemManageNumber || '';
  const number = p.itemNumber || '';

  const sortedImages = sortImagesByName(p.images || []);
  // basicモードは5枚まで、imagesモードは全部
  const displayImages = viewMode === 'images' ? sortedImages : sortedImages.slice(0, 5);
  const remaining = sortedImages.length - displayImages.length;

  const imgsHTML = displayImages.map(img => `
    <div class="product-row-thumb" data-open-product="${p.id}" title="${escapeHtml(getImageSortKey(img))}">
      <img src="${escapeHtml(img.url)}" alt="" loading="lazy">
    </div>
  `).join('');

  // 残り表示(basicモードで5枚超え)
  const moreHTML = remaining > 0
    ? `<div class="product-row-more" data-open-product="${p.id}" title="残り${remaining}枚">+${remaining}</div>`
    : '';

  const manageCell = manage
    ? `<span class="mono">${escapeHtml(manage)}</span>`
    : `<span class="mono mono-placeholder">10000000</span>`;
  const numberCell = number
    ? `<span class="mono">${escapeHtml(number)}</span>`
    : `<span class="mono mono-placeholder">cab-16-01</span>`;

  // タグ表示
  const tagIds = p.tagIds || [];
  const allTags = getCurrentTags();
  const productTags = tagIds
    .map(id => allTags.find(t => t.id === id))
    .filter(Boolean);
  const tagChipsHTML = productTags.map(t => {
    const c = getTagColor(t.color);
    return `<span class="tag-chip" style="background:${c.bg};color:${c.fg}">${escapeHtml(t.name)}</span>`;
  }).join('');

  const addBtnHTML = isEmpty
    ? `<button class="thumb-add" data-add-img="${p.id}" title="画像を追加">
        <span class="thumb-add-icon">＋</span>
        <span class="thumb-add-empty">未登録</span>
      </button>`
    : '';

  const actionsCellHTML = `<div class="col-actions">
    <div class="product-row-tags">
      ${tagChipsHTML}
      <button class="btn-tag-add" data-tag-picker-btn="${p.id}" title="タグを追加">🏷️ +タグ</button>
    </div>
    <button class="btn-edit-mini" data-edit-product="${p.id}">✏️ 編集</button>
  </div>`;

  const imagesCellHTML = `<div class="col-images">
    <div class="product-row-images">
      ${addBtnHTML}
      ${imgsHTML}
      ${moreHTML}
    </div>
  </div>`;

  if (viewMode === 'images') {
    // 画像全体モード: 商品番号・画像・タグ操作
    return `<div class="product-row mode-images ${isEmpty ? 'empty' : ''}">
      <div class="col-number">${numberCell}</div>
      ${imagesCellHTML}
      ${actionsCellHTML}
    </div>`;
  }

  // 基礎情報モード
  return `<div class="product-row mode-basic ${isEmpty ? 'empty' : ''}">
    <div class="col-manage">${manageCell}</div>
    <div class="col-number">${numberCell}</div>
    <div class="col-name">
      <div class="product-row-name" title="${escapeHtml(p.itemName)}">${escapeHtml(p.itemName)}</div>
    </div>
    ${imagesCellHTML}
    ${actionsCellHTML}
  </div>`;
}

function renderMaterialGrid(entries) {
  const content = document.getElementById('content');
  let list = entries.slice();
  if (searchQuery) {
    list = list.filter(e => (e.name || '').toLowerCase().includes(searchQuery));
  }

  if (list.length === 0) {
    const catName = currentCategory === 'material' ? '素材' : '盛り上げ';
    content.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎨</div>
      <div class="empty-title">${entries.length === 0 ? `${catName}データがありません` : '該当データがありません'}</div>
      <div class="empty-desc">${entries.length === 0 ? '右上の「+ 追加」から登録してください' : '検索条件を変えてみてください'}</div>
    </div>`;
    return;
  }

  const html = `<div class="material-grid">${list.map(e => materialTileHTML(e)).join('')}</div>`;
  content.innerHTML = html;
  content.querySelectorAll('.material-tile').forEach(el => {
    el.addEventListener('click', () => openMaterialModal(el.dataset.id));
  });
}

function materialTileHTML(e) {
  const imgCount = (e.images || []).length;
  const thumb = imgCount > 0
    ? `<img src="${escapeHtml(e.images[0].url)}" alt="">`
    : '🎨';
  return `<div class="material-tile" data-id="${e.id}">
    <div class="material-tile-thumb">${thumb}</div>
    <div class="material-tile-info">
      <div class="material-tile-name">${escapeHtml(e.name)}</div>
      <div class="material-tile-count">${imgCount}枚</div>
    </div>
  </div>`;
}

// =====================================================
// 商品モーダル (画像アップロード&一覧)
// =====================================================
function openProductModal(productId) {
  currentProductId = productId;
  const data = dataCache[currentShopId];
  const p = data.products.find(x => x.id === productId);
  if (!p) return;

  document.getElementById('productModalTitle').textContent = p.itemName || '(無題)';
  document.getElementById('productModalMeta').textContent = `商品管理番号: ${p.itemManageNumber || '—'}  |  商品番号: ${p.itemNumber || '—'}  |  商品コード: ${p.itemCode || '—'}`;
  renderProductImageGrid(p);
  document.getElementById('productModal').style.display = 'flex';
}

function openProductEditForm(productId) {
  const data = dataCache[currentShopId];
  const p = data.products.find(x => x.id === productId);
  if (!p) return;
  document.getElementById('productEditId').value = p.id;
  document.getElementById('productEditManageNumber').value = p.itemManageNumber || '';
  document.getElementById('productEditNumber').value = p.itemNumber || '';
  document.getElementById('productEditName').value = p.itemName || '';
  document.getElementById('productEditItemCode').textContent = p.itemCode || '—';
  document.getElementById('productEditModal').style.display = 'flex';
}

async function saveProductEditForm() {
  const id = document.getElementById('productEditId').value;
  const data = dataCache[currentShopId];
  const p = data.products.find(x => x.id === id);
  if (!p) return;
  p.itemManageNumber = document.getElementById('productEditManageNumber').value.trim();
  p.itemNumber = document.getElementById('productEditNumber').value.trim();
  p.itemName = document.getElementById('productEditName').value.trim();

  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `edit product: ${p.itemName}`);
    hideLoading();
    closeModal('productEditModal');
    toast('保存しました', 'success');
    render();
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

function openMaterialModal(entryId) {
  currentProductId = entryId;
  const data = dataCache[currentShopId];
  const list = currentCategory === 'material' ? data.materials : data.boosts;
  const e = list.find(x => x.id === entryId);
  if (!e) return;
  document.getElementById('productModalTitle').textContent = e.name || '(無題)';
  document.getElementById('productModalMeta').textContent = e.note || '';
  renderProductImageGrid(e);
  document.getElementById('productModal').style.display = 'flex';
}

function getCurrentEntry() {
  const data = dataCache[currentShopId];
  if (!data) return null;
  if (currentCategory === 'product') return data.products.find(x => x.id === currentProductId);
  if (currentCategory === 'material') return data.materials.find(x => x.id === currentProductId);
  if (currentCategory === 'boost') return data.boosts.find(x => x.id === currentProductId);
  return null;
}

function renderProductImageGrid(entry) {
  const grid = document.getElementById('productImageGrid');
  const images = sortImagesByName(entry.images || []);
  if (images.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--text-light)">
      📷 まだ画像がありません。上のエリアからアップロードしてください
    </div>`;
    return;
  }
  grid.innerHTML = images.map(img => `
    <div class="image-tile" data-img-id="${img.id}">
      <div class="image-tile-thumb"><img src="${escapeHtml(img.url)}" alt="" loading="lazy"></div>
      <div class="image-tile-info">
        <div class="image-tile-name" title="${escapeHtml(getImageSortKey(img))}">${escapeHtml(getImageSortKey(img))}</div>
        ${(img.tags && img.tags.length)
          ? `<div class="image-tile-tags">${img.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
          : ''}
      </div>
    </div>
  `).join('');
  grid.querySelectorAll('.image-tile').forEach(el => {
    el.addEventListener('click', () => openImageDetail(el.dataset.imgId));
  });
}

async function uploadFiles(files) {
  if (!files.length) return;
  const entry = getCurrentEntry();
  if (!entry) { toast('対象が選択されていません', 'error'); return; }

  const progress = document.getElementById('uploadProgress');
  progress.style.display = 'block';

  let success = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    progress.textContent = `アップロード中 ${i + 1}/${files.length}: ${f.name}`;
    try {
      const productLinkId = currentCategory === 'product' ? entry.id : (entry.productId || null);
      const imgMeta = await uploadImageToGitHub(currentShopId, productLinkId, f);
      if (!entry.images) entry.images = [];
      entry.images.push(imgMeta);
      success++;
    } catch (e) {
      console.error(e);
      failed++;
    }
  }

  progress.textContent = `保存中...`;
  try {
    await saveShopData(currentShopId, `add images x${success}`);
  } catch (e) {
    toast('JSON保存失敗: ' + e.message, 'error');
  }
  progress.style.display = 'none';
  renderProductImageGrid(entry);
  render();
  toast(`アップロード完了: 成功${success}件${failed ? ` / 失敗${failed}件` : ''}`, failed ? 'error' : 'success');
}

// =====================================================
// 画像詳細モーダル
// =====================================================
function openImageDetail(imgId) {
  const entry = getCurrentEntry();
  if (!entry) return;
  const img = (entry.images || []).find(i => i.id === imgId);
  if (!img) return;

  currentImageId = imgId;
  const displayName = getImageSortKey(img);
  document.getElementById('imageDetailImg').src = img.url;
  document.getElementById('imageDetailTitle').textContent = displayName;
  document.getElementById('imageDetailFilename').textContent = displayName;
  document.getElementById('imageDetailDate').textContent = formatDate(img.uploadedAt);
  document.getElementById('imageDetailNote').value = img.note || '';
  document.getElementById('btnDownloadImage').href = img.url;
  document.getElementById('btnDownloadImage').download = img.originalName || img.filename;
  renderImageTags(img.tags || []);
  document.getElementById('imageModal').style.display = 'flex';
}

function renderImageTags(tags) {
  const wrap = document.getElementById('imageDetailTags');
  wrap.innerHTML = tags.map((t, i) => `
    <span class="tag-pill">${escapeHtml(t)}<span class="tag-remove" data-i="${i}">×</span></span>
  `).join('');
  wrap.querySelectorAll('.tag-remove').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.i);
      const entry = getCurrentEntry();
      const img = (entry.images || []).find(x => x.id === currentImageId);
      img.tags.splice(i, 1);
      renderImageTags(img.tags);
    });
  });
}

function addTagFromInput() {
  const input = document.getElementById('imageDetailTagInput');
  const v = input.value.trim();
  if (!v) return;
  const entry = getCurrentEntry();
  const img = (entry.images || []).find(x => x.id === currentImageId);
  if (!img.tags) img.tags = [];
  if (!img.tags.includes(v)) img.tags.push(v);
  input.value = '';
  renderImageTags(img.tags);
}

async function saveImageDetail() {
  const entry = getCurrentEntry();
  const img = (entry.images || []).find(x => x.id === currentImageId);
  if (!img) return;
  img.note = document.getElementById('imageDetailNote').value;
  // tagsは追加/削除時に既に反映済み
  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `update image meta: ${img.filename}`);
    hideLoading();
    toast('保存しました', 'success');
    renderProductImageGrid(entry);
    render();
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

async function deleteCurrentImage() {
  const entry = getCurrentEntry();
  const img = (entry.images || []).find(x => x.id === currentImageId);
  if (!img) return;
  if (!confirm(`「${img.filename}」を削除します。元に戻せません。本当に削除しますか?`)) return;

  showLoading('画像を削除中...');
  try {
    await deleteImageFromGitHub(img);
    entry.images = entry.images.filter(x => x.id !== currentImageId);
    await saveShopData(currentShopId, `delete image: ${img.filename}`);
    hideLoading();
    closeModal('imageModal');
    renderProductImageGrid(entry);
    render();
    toast('削除しました', 'success');
  } catch (e) {
    hideLoading();
    toast('削除失敗: ' + e.message, 'error');
  }
}

function copyImageUrl() {
  const entry = getCurrentEntry();
  const img = (entry.images || []).find(x => x.id === currentImageId);
  if (!img) return;
  navigator.clipboard.writeText(img.url).then(() => {
    toast('URLをコピーしました', 'success');
  });
}

// =====================================================
// エントリー追加 (素材/盛り上げ)
// =====================================================
function openEntryForm() {
  if (currentCategory === 'product') {
    toast('「商品」は同期で自動追加されます。「+ 商品同期」をご利用ください', 'error');
    return;
  }
  document.getElementById('entryFormId').value = '';
  document.getElementById('entryFormCategory').value = currentCategory;
  document.getElementById('entryFormName').value = '';
  document.getElementById('entryFormNote').value = '';

  // 商品プルダウン
  const sel = document.getElementById('entryFormProductId');
  sel.innerHTML = '<option value="">紐づけなし (ショップ共通)</option>';
  const data = dataCache[currentShopId];
  (data.products || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.itemName} (${p.itemNumber || p.itemCode})`;
    sel.appendChild(opt);
  });

  document.getElementById('entryFormTitle').textContent = currentCategory === 'material' ? '素材を追加' : '盛り上げを追加';
  document.getElementById('entryFormModal').style.display = 'flex';
}

async function saveEntryForm() {
  const name = document.getElementById('entryFormName').value.trim();
  if (!name) { toast('名前を入力してください', 'error'); return; }
  const cat = document.getElementById('entryFormCategory').value;
  const productId = document.getElementById('entryFormProductId').value || null;
  const note = document.getElementById('entryFormNote').value;

  const entry = {
    id: 'ent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name,
    productId,
    note,
    images: [],
    createdAt: new Date().toISOString()
  };

  const data = dataCache[currentShopId];
  if (cat === 'material') data.materials.push(entry);
  else if (cat === 'boost') data.boosts.push(entry);

  showLoading('保存中...');
  try {
    await saveShopData(currentShopId, `add ${cat}: ${name}`);
    hideLoading();
    closeModal('entryFormModal');
    toast('追加しました', 'success');
    render();
  } catch (e) {
    hideLoading();
    toast('保存失敗: ' + e.message, 'error');
  }
}

// =====================================================
// 設定モーダル
// =====================================================
function openSettings() {
  document.getElementById('settingPat').value = auth.pat || '';
  document.getElementById('settingOwner').value = auth.owner || '';
  document.getElementById('settingRepo').value = auth.repo || '';
  document.getElementById('settingBranch').value = auth.branch || 'main';
  renderShopsList();
  document.getElementById('settingsModal').style.display = 'flex';
}

function renderShopsList() {
  const wrap = document.getElementById('shopsList');
  if (shops.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-light);font-size:13px">まだショップがありません</div>';
    return;
  }
  wrap.innerHTML = shops.map(s => `
    <div class="shop-row">
      <div class="shop-row-info">
        <div class="shop-row-name">${escapeHtml(s.name)}</div>
        <div class="shop-row-meta">${escapeHtml(s.mall)} / ${escapeHtml(s.shopCode || '—')}</div>
      </div>
      <div class="shop-row-actions">
        <button class="btn-icon-mini" data-edit="${s.id}">編集</button>
        <button class="btn-icon-mini danger" data-del="${s.id}">削除</button>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openShopForm(b.dataset.edit)));
  wrap.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteShop(b.dataset.del)));
}

function saveSettings() {
  auth.pat = document.getElementById('settingPat').value.trim();
  auth.owner = document.getElementById('settingOwner').value.trim();
  auth.repo = document.getElementById('settingRepo').value.trim();
  auth.branch = document.getElementById('settingBranch').value.trim() || 'main';
  saveAuth();
  toast('設定を保存しました', 'success');
  closeModal('settingsModal');
  // 現在のショップデータを再ロード
  delete dataCache[currentShopId];
  loadCurrentShopData().then(() => render());
}

// =====================================================
// ショップ追加・編集
// =====================================================
function openShopForm(shopId) {
  document.getElementById('shopFormId').value = shopId || '';
  if (shopId) {
    const s = shops.find(x => x.id === shopId);
    if (!s) return;
    document.getElementById('shopFormTitle').textContent = 'ショップを編集';
    document.getElementById('shopFormName').value = s.name || '';
    document.getElementById('shopFormMall').value = s.mall || 'rakuten';
    document.getElementById('shopFormCode').value = s.shopCode || '';
    document.getElementById('shopFormAppId').value = s.appId || '';
    document.getElementById('shopFormAccessKey').value = s.accessKey || '';
  } else {
    document.getElementById('shopFormTitle').textContent = 'ショップを追加';
    document.getElementById('shopFormName').value = '';
    document.getElementById('shopFormMall').value = 'rakuten';
    document.getElementById('shopFormCode').value = '';
    document.getElementById('shopFormAppId').value = '';
    document.getElementById('shopFormAccessKey').value = '';
  }
  document.getElementById('shopFormModal').style.display = 'flex';
}

function saveShopForm() {
  const id = document.getElementById('shopFormId').value;
  const name = document.getElementById('shopFormName').value.trim();
  if (!name) { toast('ショップ名を入力してください', 'error'); return; }
  const obj = {
    id: id || ('shop_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    name,
    mall: document.getElementById('shopFormMall').value,
    shopCode: document.getElementById('shopFormCode').value.trim(),
    appId: document.getElementById('shopFormAppId').value.trim(),
    accessKey: document.getElementById('shopFormAccessKey').value.trim()
  };
  if (id) {
    const i = shops.findIndex(x => x.id === id);
    if (i >= 0) shops[i] = obj;
  } else {
    shops.push(obj);
    if (!currentShopId) currentShopId = obj.id;
  }
  saveAuth();
  renderShopsList();
  renderShopTabs();
  closeModal('shopFormModal');
  toast('保存しました', 'success');
  if (currentShopId === obj.id) {
    delete dataCache[currentShopId];
    loadCurrentShopData().then(() => render());
  }
}

function deleteShop(shopId) {
  const s = shops.find(x => x.id === shopId);
  if (!s) return;
  if (!confirm(`ショップ「${s.name}」を削除します。\n※GitHub上のデータは残ります。完全削除はGitHubから手動で行ってください。\n本当に削除しますか?`)) return;
  shops = shops.filter(x => x.id !== shopId);
  if (currentShopId === shopId) {
    currentShopId = shops[0]?.id || null;
    localStorage.setItem(LS_CURRENT_SHOP, currentShopId || '');
  }
  delete dataCache[shopId];
  saveAuth();
  renderShopsList();
  renderShopTabs();
  loadCurrentShopData().then(() => render());
  toast('削除しました', 'success');
}

// =====================================================
// ユーティリティ
// =====================================================
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function goHome() {
  currentCategory = 'product';
  searchQuery = '';
  filterUnregistered = false;
  document.getElementById('searchInput').value = '';
  document.getElementById('filterUnregistered').checked = false;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === 'product'));
  render();
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => { el.className = 'toast' + (type ? ' ' + type : ''); }, 2800);
}

function showLoading(text) {
  document.getElementById('loadingText').textContent = text || '処理中...';
  document.getElementById('loadingOverlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}
