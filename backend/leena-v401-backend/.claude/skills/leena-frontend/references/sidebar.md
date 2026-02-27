# Sidebar HTML — Copy EXACTLY for new admin pages

## Full Sidebar HTML

```html
<nav class="sidebar">
    <div class="sidebar-header">
        <img src="assets/Leena_logo_white_nobg.png" alt="Leena" class="sidebar-logo">
    </div>
    <a id="sidebarExpo" href="dashboard_new.html" title="Switch Expo" style="padding:8px 20px;font-size:11px;color:#9ca3af;border-bottom:1px solid #252542;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none;text-decoration:none;cursor:pointer;"><i class="bi bi-geo-alt" style="margin-right:4px;color:#4a6fa5;"></i><span id="expoNameDisplay"></span> <i class="bi bi-arrow-left-right" style="float:right;font-size:9px;opacity:0.5;margin-top:2px;"></i></a>
    <script>(function(){var n=localStorage.getItem('selectedExpoName'),el=document.getElementById('sidebarExpo');if(n&&el){document.getElementById('expoNameDisplay').textContent=n;el.style.display='block';}})();</script>
    <div class="sidebar-nav">
        <div class="nav-section">
            <div class="nav-section-title">Overview</div>
            <a class="nav-item" href="main-panel-v2.html"><i class="bi bi-grid-1x2"></i><span>Dashboard</span></a>
        </div>
        <div class="nav-section">
            <div class="nav-section-title">Management</div>
            <a class="nav-item" href="visitorlog-paginated.html"><i class="bi bi-people"></i><span>Visitors</span></a>
            <a class="nav-item" href="form-list.html"><i class="bi bi-ui-checks-grid"></i><span>Forms</span></a>
            <a class="nav-item" href="checkins.html"><i class="bi bi-check2-square"></i><span>Check-ins</span></a>
            <a class="nav-item" href="terminals.html"><i class="bi bi-pc-display"></i><span>Terminals</span></a>
            <a class="nav-item" href="conference-sessions.html"><i class="bi bi-mortarboard"></i><span>Conferences</span></a>
        </div>
        <div class="nav-section">
            <div class="nav-section-title">Communication</div>
            <a class="nav-item" href="email-templates.html"><i class="bi bi-envelope"></i><span>Email Templates</span></a>
            <a class="nav-item" href="email-send.html"><i class="bi bi-send"></i><span>Send Emails</span></a>
            <a class="nav-item" href="email-segments.html"><i class="bi bi-megaphone"></i><span>Email Segments</span></a>
        </div>
        <div class="nav-section">
            <div class="nav-section-title">Settings</div>
            <a class="nav-item" href="badge-templates.html"><i class="bi bi-person-badge"></i><span>Badge Templates</span></a>
            <a class="nav-item" href="reactivation-campaign.html"><i class="bi bi-arrow-repeat"></i><span>Re-activation</span></a>
        </div>
        <div class="nav-divider"></div>
        <div class="nav-section">
            <div class="nav-section-title">Tools</div>
            <a class="nav-item" href="checkin-reports.html"><i class="bi bi-clipboard-data"></i><span>Check-in Reports</span></a>
            <a class="nav-item" href="reports.html"><i class="bi bi-graph-up"></i><span>Reports</span></a>
            <a class="nav-item" href="import.html"><i class="bi bi-download"></i><span>Import</span></a>
        </div>
    </div>
</nav>
```

## Sidebar CSS (required in every page's `<style>` block)

```css
.sidebar { width: 256px; background: var(--sidebar-bg); position: fixed; top: 0; left: 0; bottom: 0; display: flex; flex-direction: column; }
.sidebar-header { padding: 20px; border-bottom: 1px solid #252542; }
.sidebar-logo { height: 80px; }
.sidebar-nav { flex: 1; padding: 16px 12px; }
.nav-section { margin-bottom: 24px; }
.nav-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--sidebar-text); padding: 0 12px 8px; }
.nav-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; color: var(--sidebar-text); text-decoration: none; border-radius: var(--radius-md); margin-bottom: 2px; transition: all 0.15s; position: relative; }
.nav-item:hover { background: var(--sidebar-hover); color: var(--sidebar-text-active); }
.nav-item.active { background: #2d2d4a; color: var(--sidebar-text-active); }
.nav-item.active::before { content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 3px; height: 24px; background: var(--primary); border-radius: 0 3px 3px 0; }
.nav-item i { font-size: 18px; width: 20px; }
.nav-item span { font-size: 13px; font-weight: 500; }
.nav-divider { height: 1px; background: #252542; margin: 16px 12px; }
```

## Active Page Highlight

Add `active` class to the current page's nav-item:

```html
<!-- Example: if current page is Reports -->
<a class="nav-item active" href="reports.html"><i class="bi bi-graph-up"></i><span>Reports</span></a>
```

## 5 Sections, 14 Links

| Section | Links |
|---------|-------|
| Overview | Dashboard |
| Management | Visitors, Forms, Check-ins, Terminals, Conferences |
| Communication | Email Templates, Send Emails, Email Segments |
| Settings | Badge Templates, Re-activation |
| Tools | Check-in Reports, Reports, Import |

## Mobile Behavior

```css
@media (max-width: 768px) {
    .sidebar { display: none; }
    .main-wrapper { margin-left: 0; }
}
```

⚠️ Full mobile hamburger menu is NOT yet implemented (Sprint 5 planned).
