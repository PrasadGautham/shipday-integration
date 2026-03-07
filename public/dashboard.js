let dashboardData = null;
let selectedStoreId = '';
let selectedStoreName = '';
let selectedStatus = '';
let searchText = '';
let selectedGranularity = 'daily';
let currentPage = 1;
let pageSize = 15;

function fmtDate(iso) {
  if (!iso) {
    return '-';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

function fmtNumber(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return `${value}${suffix}`;
}

function statusClass(status) {
  if (['ALREADY_DELIVERED', 'DELIVERED'].includes(status)) {
    return 'status-ok';
  }
  if (['FAILED_DELIVERY', 'INCOMPLETE'].includes(status)) {
    return 'status-bad';
  }
  return 'status-warn';
}

function card(label, value) {
  return `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function getDateFilters() {
  return {
    from: document.getElementById('fromDate').value || '',
    to: document.getElementById('toDate').value || ''
  };
}

function initStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const status = params.get('status') || '';
  const search = params.get('search') || '';
  const granularity = params.get('granularity') || 'daily';
  const page = Number.parseInt(params.get('page') || '1', 10);
  const size = Number.parseInt(params.get('pageSize') || '15', 10);

  document.getElementById('fromDate').value = from;
  document.getElementById('toDate').value = to;
  document.getElementById('searchInput').value = search;
  document.getElementById('granularityFilter').value = granularity === 'hourly' ? 'hourly' : 'daily';

  searchText = search.toLowerCase();
  selectedGranularity = granularity === 'hourly' ? 'hourly' : 'daily';
  currentPage = Number.isFinite(page) && page > 0 ? page : 1;
  pageSize = [10, 15, 25, 50].includes(size) ? size : 15;
  selectedStatus = status;
}

function syncUrlState() {
  const dates = getDateFilters();
  const params = new URLSearchParams();
  if (dates.from) params.set('from', dates.from);
  if (dates.to) params.set('to', dates.to);
  if (selectedStatus) params.set('status', selectedStatus);
  if (searchText) params.set('search', searchText);
  if (selectedGranularity) params.set('granularity', selectedGranularity);
  params.set('page', String(currentPage));
  params.set('pageSize', String(pageSize));
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState({}, '', next);
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      query.set(key, value);
    }
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

function renderSummary() {
  const summary = dashboardData.summary;
  const html = [
    card('Total Orders', summary.totalOrders),
    card('Delivered', summary.deliveredOrders),
    card('In Progress', summary.inProgressOrders),
    card('Failed', summary.failedOrders),
    card('Avg Delivery', fmtNumber(summary.avgDeliveryMins, ' mins'))
  ].join('');
  document.getElementById('summaryCards').innerHTML = html;
  document.getElementById('generatedAt').textContent = `Updated ${fmtDate(dashboardData.generatedAt)}`;
}

function renderStores() {
  const wrap = document.getElementById('stores');
  wrap.innerHTML = dashboardData.stores
    .map(
      (store) => `
      <button class="company-btn ${selectedStoreId === store.storeId ? 'active' : ''}" data-store-id="${store.storeId}">
        <strong>${store.storeName}</strong>
        <div class="company-meta">${store.storeAddress || '-'}</div>
        <div class="company-meta">
          Orders ${store.totalOrders} | Delivered ${store.deliveredOrders} | Avg ${fmtNumber(store.avgDeliveryMins, 'm')}
        </div>
      </button>
    `
    )
    .join('');

  wrap.querySelectorAll('.company-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const storeId = btn.dataset.storeId;
      const dates = getDateFilters();
      const query = buildQuery({ storeId, from: dates.from, to: dates.to });
      window.location.assign(`/dashboard/store${query}`);
    });
  });
}

function getFilteredOrders() {
  return dashboardData.orders.filter((order) => {
    if (selectedStoreId && order.store.id !== selectedStoreId) {
      return false;
    }
    if (selectedStatus && order.currentStatus !== selectedStatus) {
      return false;
    }
    if (searchText) {
      const hay = `${order.orderNumber} ${order.orderId} ${order.customer.name} ${order.store.name} ${order.store.address || ''}`.toLowerCase();
      if (!hay.includes(searchText)) {
        return false;
      }
    }
    return true;
  });
}

function renderPagination(containerId, totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="pagination-meta">Showing ${start}-${end} of ${totalItems}</div>
    <div class="pagination-controls">
      <button id="prevPage" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="pagination-meta">Page ${currentPage} / ${totalPages}</span>
      <select id="pageSizeSelect">
        <option value="10" ${pageSize === 10 ? 'selected' : ''}>10 / page</option>
        <option value="15" ${pageSize === 15 ? 'selected' : ''}>15 / page</option>
        <option value="25" ${pageSize === 25 ? 'selected' : ''}>25 / page</option>
        <option value="50" ${pageSize === 50 ? 'selected' : ''}>50 / page</option>
      </select>
      <button id="nextPage" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
    </div>
  `;

  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');
  if (prev) {
    prev.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderOrders();
      }
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage += 1;
        renderOrders();
      }
    });
  }
  const sizeSelect = document.getElementById('pageSizeSelect');
  if (sizeSelect) {
    sizeSelect.addEventListener('change', (event) => {
      const parsed = Number.parseInt(event.target.value, 10);
      if ([10, 15, 25, 50].includes(parsed)) {
        pageSize = parsed;
        currentPage = 1;
        renderOrders();
      }
    });
  }
}

function renderOrders() {
  const orders = getFilteredOrders();
  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
  const startIdx = (currentPage - 1) * pageSize;
  const pageOrders = orders.slice(startIdx, startIdx + pageSize);
  const body = document.getElementById('ordersBody');
  body.innerHTML = pageOrders
    .map(
      (order, idx) => `
      <tr data-index="${idx}">
        <td data-label="Order #">${order.orderNumber}</td>
        <td data-label="Store">${order.store.name}</td>
        <td data-label="Status"><span class="badge ${statusClass(order.currentStatus)}">${order.currentStatus}</span></td>
        <td data-label="Placed">${fmtDate(order.timeline.placementAt)}</td>
        <td data-label="Delivered">${fmtDate(order.timeline.deliveredAt)}</td>
        <td data-label="Total Mins">${fmtNumber(order.metrics.minutesPlacementToDelivered, 'm')}</td>
      </tr>
    `
    )
    .join('');

  body.querySelectorAll('tr').forEach((row) => {
    row.addEventListener('click', () => {
      const order = pageOrders[Number(row.dataset.index)];
      openDrawer(order);
    });
  });

  renderPagination('ordersPagination', orders.length);
  syncUrlState();
}

function openDrawer(order) {
  const drawer = document.getElementById('detailDrawer');
  document.getElementById('drawerTitle').textContent = `Order ${order.orderNumber} (${order.orderId})`;
  const metrics = order.metrics;

  const trackingLink = order.trackingUrl
    ? `<a href="${order.trackingUrl}" target="_blank" rel="noreferrer">Open tracking URL</a>`
    : '-';

  const meta = `
    <div class="meta-list">
      <div><strong>Store:</strong> ${order.store.name}</div>
      <div><strong>Store Phone:</strong> ${order.store.phone || '-'}</div>
      <div><strong>Store Address:</strong> ${order.store.address || '-'}</div>
      <div><strong>Company:</strong> ${order.company.name}</div>
      <div><strong>Customer:</strong> ${order.customer.name}</div>
      <div><strong>Customer Phone:</strong> ${order.customer.phone || '-'}</div>
      <div><strong>Drop Address:</strong> ${order.customer.address || '-'}</div>
      <div><strong>Status:</strong> ${order.currentStatus}</div>
      <div><strong>Tracking:</strong> ${trackingLink}</div>
      <div><strong>Placement -> Pickup:</strong> ${fmtNumber(metrics.minutesPlacementToPickup, ' mins')}</div>
      <div><strong>Pickup -> Delivered:</strong> ${fmtNumber(metrics.minutesPickupToDelivered, ' mins')}</div>
      <div><strong>Placement -> Delivered:</strong> ${fmtNumber(metrics.minutesPlacementToDelivered, ' mins')}</div>
      <div><strong>Expected vs Actual Delivery:</strong> ${fmtNumber(metrics.minutesExpectedVsActualDelivery, ' mins')}</div>
    </div>
  `;

  const timeline = `
    <div class="timeline">
      ${order.events
        .map(
          (event) => `
        <div class="timeline-item">
          <strong>${event.status}</strong><br />
          <small>${fmtDate(event.receivedAt)} ${event.eventType ? `| ${event.eventType}` : ''}</small>
        </div>
      `
        )
        .join('')}
    </div>
  `;

  document.getElementById('drawerContent').innerHTML = `${meta}${timeline}`;
  drawer.classList.remove('hidden');
}

function renderTrend(points, granularity, store) {
  const wrap = document.getElementById('trendChart');
  const label = document.getElementById('trendLabel');
  const scope = store || 'All stores';
  label.textContent = `${scope} | ${granularity === 'hourly' ? 'Hourly' : 'Daily'} buckets`;

  if (!points.length) {
    wrap.innerHTML = '<p class="subtle">No trend points in selected date range.</p>';
    return;
  }

  const maxOrders = Math.max(...points.map((point) => point.totalOrders), 1);
  wrap.innerHTML = points
    .map((point) => {
      const height = Math.max(8, Math.round((point.totalOrders / maxOrders) * 160));
      return `
        <div class="trend-col" title="${point.bucket} | total ${point.totalOrders} | delivered ${point.deliveredOrders}">
          <div class="trend-value">${point.totalOrders}</div>
          <div class="trend-bar" style="height:${height}px"></div>
          <div class="trend-bucket">${point.bucket}</div>
        </div>
      `;
    })
    .join('');
}

async function loadTrends() {
  const dates = getDateFilters();
  const query = buildQuery({
    from: dates.from,
    to: dates.to,
    granularity: selectedGranularity,
    storeId: selectedStoreId
  });
  const response = await fetch(`/api/dashboard/trends${query}`);
  const trendData = await response.json();
  renderTrend(trendData.points || [], trendData.granularity, selectedStoreName);
}

async function loadData() {
  const dates = getDateFilters();
  const query = buildQuery(dates);
  const response = await fetch(`/api/dashboard/summary${query}`);
  dashboardData = await response.json();

  const uniqueStatuses = [...new Set(dashboardData.orders.map((order) => order.currentStatus))].sort();
  document.getElementById('statusFilter').innerHTML =
    '<option value="">All statuses</option>' +
    uniqueStatuses.map((status) => `<option value="${status}">${status}</option>`).join('');
  document.getElementById('statusFilter').value = selectedStatus || '';

  renderSummary();
  renderStores();
  renderOrders();
  await loadTrends();
}

function wireControls() {
  document.getElementById('resetStore').addEventListener('click', () => {
    selectedStoreId = '';
    selectedStoreName = '';
    currentPage = 1;
    renderStores();
    renderOrders();
    loadTrends();
  });

  document.getElementById('statusFilter').addEventListener('change', (event) => {
    selectedStatus = event.target.value;
    currentPage = 1;
    renderOrders();
  });

  document.getElementById('granularityFilter').addEventListener('change', (event) => {
    selectedGranularity = event.target.value;
    loadTrends();
  });

  document.getElementById('searchInput').addEventListener('input', (event) => {
    searchText = event.target.value.trim().toLowerCase();
    currentPage = 1;
    renderOrders();
  });

  document.getElementById('fromDate').addEventListener('change', () => {
    currentPage = 1;
    loadData();
  });

  document.getElementById('toDate').addEventListener('change', () => {
    currentPage = 1;
    loadData();
  });

  document.getElementById('closeDrawer').addEventListener('click', () => {
    document.getElementById('detailDrawer').classList.add('hidden');
  });
}

wireControls();
initStateFromUrl();
loadData().catch((err) => {
  document.getElementById('generatedAt').textContent = `Failed to load dashboard data: ${err.message}`;
});
