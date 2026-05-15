// =====================================================
// ImageGallery v1.0.0
// 楽天・Yahoo の自社画像を商品ごとに保管するLP制作支援ツール
// =====================================================

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

// =====================================================
// 起動
// =====================================================
window.addEventListener('DOMContentLoaded', init);

async function init() {
  loadAuth();
  loadCurrentSelections();
  bindEvents();
  renderShopTabs();
  await loadCurrentShopData();
  render();
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
  if (currentShopId && !shops.find(s => s.id === currentShopId)) {
    currentShopId = shops[0]?.id || null;
  } else if (!currentShopId && shops.length) {
    currentShopId = shops[0].id;
  }
}

function bindEvents() {
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnSyncProducts').addEventListener('click', syncProducts);
  document.getElementById('btnAddEntry').addEventListener('click', openEntryForm);

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    render();
  });
  document.getElementById('filterUnregistered').addEventListener('change', (e) => {
    filterUnregistered = e.target.checked;
    render();
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
      return { products: [], materials: [], boosts: [], sha: null };
    }
    const data = await res.json();
    const json = JSON.parse(b64decode(data.content.replace(/\n/g, '')));
    return {
      products: Array.isArray(json.products) ? json.products : [],
      materials: Array.isArray(json.materials) ? json.materials : [],
      boosts: Array.isArray(json.boosts) ? json.boosts : [],
      sha: data.sha
    };
  } catch (e) {
    console.error('loadShopData failed', e);
    return { products: [], materials: [], boosts: [], sha: null };
  }
}

async function saveShopData(shopId, message) {
  const data = dataCache[shopId];
  if (!data) return;
  const path = shopDataPath(shopId);
  const content = JSON.stringify({
    products: data.products,
    materials: data.materials,
    boosts: data.boosts
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
    const err = await res.json();
    throw new Error(err.message || 'GitHub保存失敗');
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
          all.push({
            itemCode: item.itemCode,         // shopCode:itemUrl
            itemUrl: item.itemUrl,
            itemName: item.itemName,
            itemNumber: item.itemCode.split(':')[1] || '',  // 商品管理番号 (推定)
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
    const existingByCode = new Map(existing.map(p => [p.itemCode, p]));

    let added = 0;
    items.forEach(it => {
      if (existingByCode.has(it.itemCode)) {
        // 既存の商品は商品名のみ更新 (画像データは保持)
        const e = existingByCode.get(it.itemCode);
        e.itemName = it.itemName;
        e.itemUrl = it.itemUrl;
        e.itemPrice = it.itemPrice;
        e.rakutenThumb = it.mediumImageUrl;
      } else {
        // 新商品
        data.products.push({
          id: 'prod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          itemCode: it.itemCode,
          itemNumber: it.itemNumber,
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
  if (dataCache[currentShopId]) return;  // 既にキャッシュ済み
  showLoading('データを読み込み中...');
  try {
    dataCache[currentShopId] = await loadShopData(currentShopId);
  } catch (e) {
    toast('読み込み失敗: ' + e.message, 'error');
    dataCache[currentShopId] = { products: [], materials: [], boosts: [], sha: null };
  }
  hideLoading();
}

// =====================================================
// 描画
// =====================================================
function render() {
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
      (p.itemNumber || '').toLowerCase().includes(searchQuery)
    );
  }
  if (filterUnregistered) {
    list = list.filter(p => !p.images || p.images.length === 0);
  }

  if (list.length === 0) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📦</div>
      <div class="empty-title">${products.length === 0 ? '商品データがありません' : '該当する商品がありません'}</div>
      <div class="empty-desc">${products.length === 0 ? '右上の「商品同期」を押して楽天から商品を取り込んでください' : '検索条件を変えてみてください'}</div>
    </div>`;
    return;
  }

  const html = `<div class="product-grid">${list.map(p => productCardHTML(p)).join('')}</div>`;
  content.innerHTML = html;

  // bind click
  content.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => openProductModal(card.dataset.id));
  });
}

function productCardHTML(p) {
  const imgCount = (p.images || []).length;
  const isEmpty = imgCount === 0;
  let thumb;
  if (isEmpty) {
    if (p.rakutenThumb) {
      thumb = `<img src="${escapeHtml(p.rakutenThumb)}" alt="" loading="lazy">`;
    } else {
      thumb = '<span class="thumb-placeholder">📷</span>';
    }
  } else {
    thumb = `<img src="${escapeHtml(p.images[0].url)}" alt="" loading="lazy">`;
  }
  const badges = isEmpty
    ? '<span class="badge badge-empty">📷 未登録</span>'
    : `<span class="badge badge-count">${imgCount}枚</span>`;
  return `<div class="product-card ${isEmpty ? 'empty' : ''}" data-id="${p.id}">
    <div class="product-card-thumb">${thumb}</div>
    <div class="product-card-info">
      <div class="product-card-name" title="${escapeHtml(p.itemName)}">${escapeHtml(p.itemName)}</div>
      <div class="product-card-code">${escapeHtml(p.itemNumber || p.itemCode || '')}</div>
      <div class="product-card-badges">${badges}</div>
    </div>
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
  document.getElementById('productModalMeta').textContent = `商品管理番号: ${p.itemNumber || '—'}  |  商品コード: ${p.itemCode || '—'}`;
  renderProductImageGrid(p);
  document.getElementById('productModal').style.display = 'flex';
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
  const images = entry.images || [];
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
        <div class="image-tile-name" title="${escapeHtml(img.filename)}">${escapeHtml(img.filename)}</div>
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
  document.getElementById('imageDetailImg').src = img.url;
  document.getElementById('imageDetailTitle').textContent = img.filename;
  document.getElementById('imageDetailFilename').textContent = img.filename;
  document.getElementById('imageDetailDate').textContent = formatDate(img.uploadedAt);
  document.getElementById('imageDetailNote').value = img.note || '';
  document.getElementById('btnDownloadImage').href = img.url;
  document.getElementById('btnDownloadImage').download = img.filename;
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
