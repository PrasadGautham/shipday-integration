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

function buildQuery(storeId, from, to) {
  const q = new URLSearchParams();
  if (storeId) q.set('storeId', storeId);
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  return q.toString();
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
      const next = `/dashboard/store?${buildQuery(btn.dataset.storeId, from, to)}`;
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

  document.getElementById('ordersBody').innerHTML = data.orders
    .map((order) => {
      const tracking = order.trackingUrl
        ? `<a href="${order.trackingUrl}" target="_blank" rel="noreferrer">Open</a>`
        : '-';
      return `
        <tr>
          <td>${order.orderNumber}</td>
          <td><span class="badge ${statusClass(order.currentStatus)}">${order.currentStatus}</span></td>
          <td>${fmtDate(order.timeline.placementAt)}</td>
          <td>${fmtDate(order.timeline.deliveredAt)}</td>
          <td>${fmt(order.metrics.minutesPlacementToDelivered, 'm')}</td>
          <td>${tracking}</td>
        </tr>
      `;
    })
    .join('');
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
    document.getElementById('orderCount').textContent = '';
    return;
  }

  const query = buildQuery(storeId, fromInput.value, toInput.value);
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
    const next = storeId
      ? `/dashboard/store?${buildQuery(storeId, from, to)}`
      : `/dashboard/store?${buildQuery('', from, to)}`;
    window.location.assign(next);
  });
}

wire();
load().catch((err) => {
  document.getElementById('storeTitle').textContent = `Failed to load store: ${err.message}`;
});
