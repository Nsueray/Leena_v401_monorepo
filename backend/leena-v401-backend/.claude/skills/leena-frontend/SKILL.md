---
name: leena-frontend
description: >
  USE THIS SKILL whenever creating or modifying an admin HTML page in Leena EMS.
  Contains the exact sidebar HTML, CSS variables, page skeleton, API call patterns,
  pagination JS, filter UI, stats cards, table rendering, and export patterns.
  TRIGGER: any task involving public/*.html files, new admin pages, or frontend UI changes.
---

> **Last verified:** v402 (March 2026)
> Update this skill whenever routes, schema, or frontend patterns change.

# Leena Frontend Patterns

## Page Skeleton (Gen 3 — use for ALL new pages)

Every admin page follows this structure. See `templates/admin-page-template.html` for a complete copy-paste starter.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Page Title — Leena EMS</title>
    <link rel="icon" type="image/png" sizes="96x96" href="/assets/favicon-96x96.png">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css">
    <style>
        /* CSS variables + full page CSS (inline, not external file) */
    </style>
</head>
<body>
    <div class="app-shell">
        <!-- SIDEBAR (exact HTML in references/sidebar.md) -->
        <aside class="sidebar">...</aside>

        <div class="main-wrapper">
            <!-- HEADER -->
            <div class="page-header">
                <div>
                    <h1>Page Title</h1>
                    <p class="subtitle">Description text</p>
                </div>
                <div class="header-actions">
                    <button class="btn btn-primary" onclick="...">
                        <i class="bi bi-icon"></i> Action
                    </button>
                </div>
            </div>

            <!-- STATS CARDS -->
            <div class="stats-grid">...</div>

            <!-- FILTERS (optional) -->
            <div class="card" style="margin-bottom: 24px;">...</div>

            <!-- MAIN TABLE -->
            <div class="card">
                <div class="table-responsive">
                    <table class="data-table">...</table>
                </div>
                <!-- PAGINATION -->
                <div class="pagination" id="pagination"></div>
            </div>
        </div>
    </div>

    <script>
        // Auth check + API calls + rendering
    </script>
</body>
</html>
```

---

## CSS Variables (copy exactly for new pages)

> **CSS variable names differ between old and new pages.**
> OLD pages use: `--bg`, `--card-bg`, `--text`, `--border`, `--radius`
> NEW pages (Gen 3) use: `--bg-main`, `--bg-card`, `--text-primary`, `--border-color`, `--radius-lg`
> **For ALL new pages, use the Gen 3 names from `templates/admin-page-template.html`.**
> Do NOT rename variables in existing pages — this will break them.

```css
:root {
    --primary: #4a6fa5; --primary-hover: #3d5d8a; --primary-light: #eef2f7;
    --sidebar-bg: #1a1a2e; --sidebar-hover: #252542; --sidebar-text: #9ca3af; --sidebar-text-active: #fff;
    --bg-main: #f8fafc; --bg-card: #fff; --border-color: #e2e8f0;
    --text-primary: #0f172a; --text-secondary: #475569; --text-muted: #94a3b8;
    --success: #10b981; --success-bg: #d1fae5; --danger: #ef4444; --danger-bg: #fee2e2;
    --info: #3b82f6; --info-bg: #dbeafe; --warning: #f59e0b; --warning-bg: #fef3c7;
    --radius-md: 8px; --radius-lg: 12px;
}
```

---

## Auth Check (DOMContentLoaded)

Every admin page MUST include this at the start of the script:

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    const expoId = localStorage.getItem('selectedExpoId');
    if (!expoId) {
        window.location.href = 'dashboard_new.html';
        return;
    }

    // Load initial data
    loadData();
});
```

---

## Sidebar

Copy the EXACT sidebar HTML from `references/sidebar.md`.
- Set `.active` class on the current page's `nav-item`
- Include the sidebar CSS from the same reference file
- Do NOT modify sidebar links without updating references/sidebar.md

For auto-highlighting, add this script after the sidebar HTML:

```javascript
// Auto-highlight current page in sidebar
document.querySelectorAll('.nav-item').forEach(a => {
    if (a.getAttribute('href') === location.pathname.split('/').pop()) {
        a.classList.add('active');
    }
});
```

---

## API Call Pattern

```javascript
const API_URL = '/api';

async function loadData() {
    try {
        const token = localStorage.getItem('token');
        const expoId = localStorage.getItem('selectedExpoId');

        const res = await fetch(`${API_URL}/my-endpoint?expo_id=${expoId}&page=${currentPage}&limit=20`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();

        if (data.success) {
            renderData(data.items);
            renderPagination(data.page, data.totalPages, data.total);
        }
    } catch (err) {
        console.error('Error loading data:', err);
        // Show empty state or error message
    }
}
```

### POST request pattern:

```javascript
async function saveItem(payload) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/my-endpoint`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
        alert('Saved successfully');
        loadData();
    } else {
        alert(data.message || 'Error');
    }
}
```

---

## Stats Grid

```html
<div class="stats-grid">
    <div class="stat-card">
        <div class="stat-icon" style="background: var(--primary-light); color: var(--primary);">
            <i class="bi bi-envelope"></i>
        </div>
        <div class="stat-info">
            <div class="stat-value" id="statTotal">-</div>
            <div class="stat-label">Total Items</div>
        </div>
    </div>
    <div class="stat-card">
        <div class="stat-icon" style="background: var(--success-light); color: var(--success);">
            <i class="bi bi-check-circle"></i>
        </div>
        <div class="stat-info">
            <div class="stat-value" id="statSuccess">-</div>
            <div class="stat-label">Successful</div>
        </div>
    </div>
    <!-- More stat cards... -->
</div>
```

CSS for stats grid:

```css
.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 20px;
    margin-bottom: 24px;
}
.stat-card {
    background: var(--bg-card);
    border-radius: var(--radius-lg);
    padding: 24px;
    display: flex;
    align-items: center;
    gap: 16px;
    border: 1px solid var(--border-color);
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.stat-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
}
.stat-value { font-size: 28px; font-weight: 700; color: var(--text-primary); }
.stat-label { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
```

---

## Filter Row Pattern

```html
<div class="card" style="margin-bottom: 24px; padding: 20px;">
    <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: end;">
        <div style="flex: 1; min-width: 180px;">
            <label style="...">Template</label>
            <select id="filterTemplate" class="form-control">
                <option value="">All Templates</option>
            </select>
        </div>
        <div style="flex: 1; min-width: 140px;">
            <label style="...">Status</label>
            <select id="filterStatus" class="form-control">
                <option value="">All</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
            </select>
        </div>
        <div style="flex: 1; min-width: 200px;">
            <label style="...">Search</label>
            <input type="text" id="filterSearch" class="form-control" placeholder="Search...">
        </div>
        <div style="display: flex; gap: 8px;">
            <button class="btn btn-primary" onclick="applyFilters()">
                <i class="bi bi-funnel"></i> Apply
            </button>
            <button class="btn btn-secondary" onclick="clearFilters()">Clear</button>
        </div>
    </div>
</div>
```

---

## Table + Pagination

### Table HTML:

```html
<div class="table-responsive">
    <table class="data-table">
        <thead>
            <tr>
                <th>Column 1</th>
                <th>Column 2</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody id="tableBody">
            <tr><td colspan="3" style="text-align:center; padding:40px; color:var(--text-secondary);">
                Loading...
            </td></tr>
        </tbody>
    </table>
</div>
<div class="pagination" id="pagination"></div>
```

### Table CSS:

```css
.data-table { width: 100%; border-collapse: collapse; }
.data-table th {
    text-align: left; padding: 12px 16px;
    font-size: 12px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; color: var(--text-secondary);
    border-bottom: 2px solid var(--border-color); background: #fafbfc;
}
.data-table td {
    padding: 12px 16px; border-bottom: 1px solid var(--border-color);
    font-size: 14px; color: var(--text-primary);
}
.data-table tr:hover { background: #f8f9fa; }
```

### Render function:

```javascript
function renderTable(items) {
    const tbody = document.getElementById('tableBody');
    if (!items || items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-secondary);">
            No data found</td></tr>`;
        return;
    }
    tbody.innerHTML = items.map(item => `
        <tr>
            <td>${escapeHtml(item.name || '')}</td>
            <td>${escapeHtml(item.email || '')}</td>
            <td><span class="badge badge-${item.status === 'sent' ? 'success' : 'danger'}">
                ${item.status === 'sent' ? '✓ Sent' : '✗ Failed'}</span></td>
        </tr>
    `).join('');
}
```

### Pagination JS:

```javascript
let currentPage = 1;

function renderPagination(page, totalPages, total) {
    const container = document.getElementById('pagination');
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<span style="color:var(--text-secondary); font-size:13px;">
        Showing page ${page} of ${totalPages} (${total} total)</span><div style="display:flex; gap:4px;">`;

    // Previous
    if (page > 1) {
        html += `<button class="page-btn" onclick="goToPage(${page - 1})">‹</button>`;
    }

    // Page numbers (show max 5 around current)
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);

    if (start > 1) html += `<button class="page-btn" onclick="goToPage(1)">1</button><span>...</span>`;

    for (let i = start; i <= end; i++) {
        html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }

    if (end < totalPages) html += `<span>...</span><button class="page-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;

    // Next
    if (page < totalPages) {
        html += `<button class="page-btn" onclick="goToPage(${page + 1})">›</button>`;
    }

    html += '</div>';
    container.innerHTML = html;
}

function goToPage(page) {
    currentPage = page;
    loadData();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
```

### Pagination CSS:

```css
.pagination {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 20px; border-top: 1px solid var(--border-color);
}
.page-btn {
    width: 36px; height: 36px; border: 1px solid var(--border-color);
    background: white; border-radius: 8px; cursor: pointer;
    font-size: 14px; display: flex; align-items: center; justify-content: center;
}
.page-btn:hover { background: var(--primary-light); }
.page-btn.active { background: var(--primary); color: white; border-color: var(--primary); }
```

---

## Export Pattern (fetch + blob)

```javascript
async function exportData(format) {
    try {
        const token = localStorage.getItem('token');
        const expoId = localStorage.getItem('selectedExpoId');
        const params = new URLSearchParams({ expo_id: expoId });
        // Add any active filters to params

        const res = await fetch(`${API_URL}/my-endpoint/export?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Export failed');

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Export error:', err);
        alert('Export failed');
    }
}
```

**NEVER** use `window.location.href` for exports — it won't send the auth header.

---

## Utility: escapeHtml

Every page with dynamic table rendering MUST include:

```javascript
function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}
```

---

## Badge CSS Classes

```css
.badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
.badge-success { background: var(--success-light); color: var(--success); }
.badge-danger { background: var(--danger-light); color: var(--danger); }
.badge-warning { background: var(--warning-light); color: var(--warning); }
.badge-info { background: var(--info-light); color: var(--info); }
```

---

## Loading Overlay

```html
<div class="loading-overlay" id="loadingOverlay" style="display: none;">
    <div class="loading-spinner"></div>
</div>
```

```css
.loading-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(255,255,255,0.8); display: flex;
    align-items: center; justify-content: center; z-index: 9999;
}
.loading-spinner {
    width: 40px; height: 40px; border: 3px solid var(--border-color);
    border-top-color: var(--primary); border-radius: 50%;
    animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

---

## Key Rules

1. **All CSS is inline** — no external CSS file. Each page has its own `<style>` block.
2. **Font**: Inter (Google Fonts), Icons: Bootstrap Icons 1.11.0 (bi-*)
3. **Sidebar**: 14 links, 5 sections. Copy EXACTLY from `references/sidebar.md`.
4. **Language**: English only — no Turkish in UI text, placeholders, or messages.
5. **localStorage keys**: `token`, `selectedExpoId`, `selectedExpoName`, `organizerId`, `organizer`
6. **API base**: Use `const API_URL = '/api';` (some old pages use other patterns — always use this one).
7. **Favicon**: `<link rel="icon" type="image/png" sizes="96x96" href="/assets/favicon-96x96.png">`
