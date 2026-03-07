function qs(name) {
  const raw = window.location.search || '';
  const normalized = raw.startsWith('??') ? `?${raw.slice(2)}` : raw;
  const params = new URLSearchParams(normalized);
  return params.get(name) || params.get(`?${name}`) || '';
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function fmt(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${value}${suffix}`;
}

function statusClass(status) {
  if (['ALREADY_DELIVERED', 'DELIVERED'].includes(status)) return 'status-ok';
  if (['FAILED_DELIVERY', 'INCOMPLETE'].includes(status)) return 'status-bad';
  return 'status-warn';
}

function card(label, value) {
  return `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

let currentPage = 1;
let pageSize = 15;

function buildQuery(storeId, from, to, page, size) {
  const q = new URLSearchParams();
  if (storeId) q.set('storeId', storeId);
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (page) q.set('page', String(page));
  if (size) q.set('pageSize', String(size));
  return q.toString();
}

function initPagingFromUrl() {
  const page = Number.parseInt(qs('page') || '1', 10);
  const size = Number.parseInt(qs('pageSize') || '15', 10);
  currentPage = Number.isFinite(page) && page > 0 ? page : 1;
  pageSize = [10, 15, 25, 50].includes(size) ? size : 15;
}

function syncUrlState(storeId) {
  const { from, to } = currentDates();
  const query = buildQuery(storeId || '', from, to, currentPage, pageSize);
  const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState({}, '', next);
}

function renderPagination(totalItems, onPageChange) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  const wrap = document.getElementById('storePagination');
  wrap.innerHTML = `
    <div class="pagination-meta">Showing ${start}-${end} of ${totalItems}</div>
    <div class="pagination-controls">
      <button id="storePrevPage" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="pagination-meta">Page ${currentPage} / ${totalPages}</span>
      <select id="storePageSizeSelect">
        <option value="10" ${pageSize === 10 ? 'selected' : ''}>10 / page</option>
        <option value="15" ${pageSize === 15 ? 'selected' : ''}>15 / page</option>
        <option value="25" ${pageSize === 25 ? 'selected' : ''}>25 / page</option>
        <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 / page</option>
      </select>
      <button id="storeNextPage" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
    </div>
  `;

  const prev = document.getElementById('storePrevPage');
  const next = document.getElementById('storeNextPage');
  if (prev) {
    prev.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage -= 1;
        onPageChange();
      }
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage += 1;
        onPageChange();
      }
    });
  }
  const sizeSelect = document.getElementById('storePageSizeSelect');
  if (sizeSelect) {
    sizeSelect.addEventListener('change', (event) => {
      const parsed = Number.parseInt(event.target.value, 10);
      if ([10, 15, 25, 50].includes(parsed)) {
        pageSize = parsed;
        currentPage = 1;
        onPageChange();
      }
    });
  }
}

function currentDates() {
  return {
    from: document.getElementById('fromDate').value,
    to: document.getElementById('toDate').value
  };
}

function renderStorePicker(stores) {
  const picker = document.getElementById('storePicker');
  const selectedStoreId = qs('storeId');
  picker.innerHTML = stores
    .map(
      (store) => `
      <button class="company-btn ${selectedStoreId === store.storeId ? 'active' : ''}" data-store-id="${store.storeId}">
        <strong>${store.storeName}</strong>
        ${selectedStoreId === store.storeId ? '<span class="badge status-ok">Selected</span>' : ''}
        <div class="company-meta">${store.storeAddress || '-'}</div>
        <div class="company-meta">Orders ${store.totalOrders} | Delivered ${store.deliveredOrders}</div>
      </button>
    `
    )
    .join('');

  picker.querySelectorAll('.company-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { from, to } = currentDates();
      const next = `/dashboard/store?${buildQuery(btn.dataset.storeId, from, to, 1, pageSize)}`;
      window.location.assign(next);
    });
  });
}

function render(data) {
  document.getElementById('storeTitle').textContent = data.store.name;
  document.getElementById('storeMeta').textContent = `${data.store.address || '-'} | ${data.store.phone || '-'}`;

  const summary = data.summary;
  document.getElementById('summaryCards').innerHTML = [
    card('Total Orders', summary.totalOrders),
    card('Delivered', summary.deliveredOrders),
    card('In Progress', summary.inProgressOrders),
    card('Failed', summary.failedOrders),
    card('Avg Delivery', fmt(summary.avgDeliveryMins, ' mins'))
  ].join('');

  document.getElementById('statusBreakdown').innerHTML = data.statusBreakdown
    .map((item) => `<div class="card"><div class="label">${item.status}</div><div class="value">${item.count}</div></div>`)
    .join('');

  document.getElementById('orderCount').textContent = `${data.orders.length} orders`;

  const totalPages = Math.max(1, Math.ceil(data.orders.length / pageSize));
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
  const startIdx = (currentPage - 1) * pageSize;
  const pageOrders = data.orders.slice(startIdx, startIdx + pageSize);

  document.getElementById('ordersBody').innerHTML = pageOrders
    .map((order) => {
      const tracking = order.trackingUrl
        ? `<a href="${order.trackingUrl}" target="_blank" rel="noreferrer">Open</a>`
        : '-';
      return `
        <tr>
          <td data-label="Order #">${order.orderNumber}</td>
          <td data-label="Status"><span class="badge ${statusClass(order.currentStatus)}">${order.currentStatus}</span></td>
          <td data-label="Placed">${fmtDate(order.timeline.placementAt)}</td>
          <td data-label="Delivered">${fmtDate(order.timeline.deliveredAt)}</td>
          <td data-label="Total Mins">${fmt(order.metrics.minutesPlacementToDelivered, 'm')}</td>
          <td data-label="Tracking">${tracking}</td>
        </tr>
      `;
    })
    .join('');

  syncUrlState(data.store.id);
  renderPagination(data.orders.length, () => render(data));
}

async function loadStoreOptions() {
  const dates = currentDates();
  const q = new URLSearchParams();
  if (dates.from) q.set('from', dates.from);
  if (dates.to) q.set('to', dates.to);
  const query = q.toString() ? `?${q.toString()}` : '';
  const res = await fetch(`/api/dashboard/stores${query}`);
  const data = await res.json();
  return data.stores || [];
}

async function load() {
  const fromInput = document.getElementById('fromDate');
  const toInput = document.getElementById('toDate');
  fromInput.value = qs('from');
  toInput.value = qs('to');

  const storeId = qs('storeId');
  if (!storeId) {
    const stores = await loadStoreOptions();
    document.getElementById('storeTitle').textContent = 'Select a store to continue';
    document.getElementById('storeMeta').textContent = stores.length
      ? `Found ${stores.length} stores in selected range.`
      : 'No stores found in selected range.';
    renderStorePicker(stores);
    document.getElementById('summaryCards').innerHTML = '';
    document.getElementById('statusBreakdown').innerHTML = '';
    document.getElementById('ordersBody').innerHTML = '';
    document.getElementById('storePagination').innerHTML = '';
    document.getElementById('orderCount').textContent = '';
    return;
  }

  const query = buildQuery(storeId, fromInput.value, toInput.value, currentPage, pageSize);
  const res = await fetch(`/api/dashboard/store-details?${query}`);
  if (!res.ok) {
    const payload = await res.json();
    throw new Error(payload.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  renderStorePicker(await loadStoreOptions());
  render(data);
}

function wire() {
  document.getElementById('applyDate').addEventListener('click', () => {
    const storeId = qs('storeId');
    const { from, to } = currentDates();
    currentPage = 1;
    const next = storeId
      ? `/dashboard/store?${buildQuery(storeId, from, to, currentPage, pageSize)}`
      : `/dashboard/store?${buildQuery('', from, to, currentPage, pageSize)}`;
    window.location.assign(next);
  });
}

initPagingFromUrl();
wire();
load().catch((err) => {
  document.getElementById('storeTitle').textContent = `Failed to load store: ${err.message}`;
});
