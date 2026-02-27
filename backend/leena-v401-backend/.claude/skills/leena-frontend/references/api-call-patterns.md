# Frontend API Call Patterns

## Standard GET with Auth

```javascript
const API_URL = '/api';

async function fetchData() {
    const token = localStorage.getItem('token');
    const expoId = localStorage.getItem('selectedExpoId');

    const res = await fetch(`${API_URL}/endpoint?expo_id=${expoId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();

    if (data.success) {
        // Use data
    }
}
```

## Standard POST with Auth

```javascript
async function postData(payload) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/endpoint`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    return data;
}
```

## Paginated Fetch

```javascript
let currentPage = 1;

async function loadPage(page = 1) {
    currentPage = page;
    const token = localStorage.getItem('token');
    const expoId = localStorage.getItem('selectedExpoId');

    // Build query params
    const params = new URLSearchParams({
        expo_id: expoId,
        page: page,
        limit: 20
    });

    // Add optional filters
    const status = document.getElementById('filterStatus')?.value;
    if (status) params.append('status', status);

    const search = document.getElementById('filterSearch')?.value?.trim();
    if (search) params.append('search', search);

    const res = await fetch(`${API_URL}/endpoint?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    if (data.success) {
        renderTable(data.items);
        renderPagination(data.page, data.totalPages, data.total);
    }
}
```

## File Export (fetch + blob)

**NEVER use `window.location.href` for exports — it won't send auth header.**

```javascript
async function exportData() {
    const token = localStorage.getItem('token');
    const expoId = localStorage.getItem('selectedExpoId');
    const params = new URLSearchParams({ expo_id: expoId });

    const res = await fetch(`${API_URL}/endpoint/export?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) { alert('Export failed'); return; }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}
```

## Template/Dropdown Fetch

```javascript
async function loadTemplates() {
    const token = localStorage.getItem('token');
    const expoId = localStorage.getItem('selectedExpoId');
    const res = await fetch(`${API_URL}/email-templates?expo_id=${expoId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const select = document.getElementById('templateSelect');
    select.innerHTML = '<option value="">All Templates</option>';
    (data.templates || []).forEach(t => {
        select.innerHTML += `<option value="${t.id}">${escapeHtml(t.name)}</option>`;
    });
}
```

## URL Parameter Reading

```javascript
document.addEventListener('DOMContentLoaded', () => {
    // Auth check first
    const token = localStorage.getItem('token');
    if (!token) { window.location.href = 'login.html'; return; }
    const expoId = localStorage.getItem('selectedExpoId');
    if (!expoId) { window.location.href = 'dashboard_new.html'; return; }

    // Read URL params
    const urlParams = new URLSearchParams(window.location.search);
    const topic = urlParams.get('conference_topic');
    const type = urlParams.get('visitor_type');

    if (topic) {
        // Pre-apply filter or load specific data
        document.getElementById('filterTopic').value = topic;
    }

    loadData();
});
```

## Error Handling Pattern

```javascript
async function safeApiCall(url, options = {}) {
    try {
        const token = localStorage.getItem('token');
        const res = await fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`
            }
        });

        if (res.status === 401) {
            localStorage.clear();
            window.location.href = 'login.html';
            return null;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error('API error:', err);
        return null;
    }
}
```
