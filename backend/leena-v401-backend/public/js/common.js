/* ============================================
   LEENA EMS - Common JavaScript v2.0
   Auth, API Helpers, Utilities
   ============================================ */

// ---- Configuration ----
const LEENA = {
    API_BASE: '/api',
    VERSION: '4.0.2',
    
    // Storage Keys
    STORAGE: {
        TOKEN: 'token',
        ORGANIZER: 'organizer',
        SELECTED_EXPO_ID: 'selectedExpoId',
        SELECTED_EXPO_NAME: 'selectedExpoName'
    }
};

// ---- Auth Helpers ----
const Auth = {
    /**
     * Get current auth token
     */
    getToken() {
        return localStorage.getItem(LEENA.STORAGE.TOKEN);
    },
    
    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!this.getToken();
    },
    
    /**
     * Get current organizer data
     */
    getOrganizer() {
        const data = localStorage.getItem(LEENA.STORAGE.ORGANIZER);
        if (!data) return null;
        try {
            return JSON.parse(data);
        } catch (e) {
            return null;
        }
    },
    
    /**
     * Set auth data after login
     */
    setAuth(token, organizer) {
        localStorage.setItem(LEENA.STORAGE.TOKEN, token);
        localStorage.setItem(LEENA.STORAGE.ORGANIZER, JSON.stringify(organizer));
    },
    
    /**
     * Clear all auth data (logout)
     */
    clearAuth() {
        localStorage.removeItem(LEENA.STORAGE.TOKEN);
        localStorage.removeItem(LEENA.STORAGE.ORGANIZER);
        localStorage.removeItem(LEENA.STORAGE.SELECTED_EXPO_ID);
        localStorage.removeItem(LEENA.STORAGE.SELECTED_EXPO_NAME);
    },
    
    /**
     * Redirect to login if not authenticated
     */
    requireAuth() {
        if (!this.isAuthenticated()) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    },
    
    /**
     * Logout and redirect to login
     */
    logout() {
        this.clearAuth();
        window.location.href = 'login.html';
    }
};

// ---- Expo Helpers ----
const Expo = {
    /**
     * Get selected expo ID
     */
    getSelectedId() {
        return localStorage.getItem(LEENA.STORAGE.SELECTED_EXPO_ID);
    },
    
    /**
     * Get selected expo name
     */
    getSelectedName() {
        return localStorage.getItem(LEENA.STORAGE.SELECTED_EXPO_NAME);
    },
    
    /**
     * Set selected expo
     */
    setSelected(id, name) {
        localStorage.setItem(LEENA.STORAGE.SELECTED_EXPO_ID, id);
        if (name) {
            localStorage.setItem(LEENA.STORAGE.SELECTED_EXPO_NAME, name);
        }
    },
    
    /**
     * Clear selected expo
     */
    clearSelected() {
        localStorage.removeItem(LEENA.STORAGE.SELECTED_EXPO_ID);
        localStorage.removeItem(LEENA.STORAGE.SELECTED_EXPO_NAME);
    },
    
    /**
     * Check if expo is selected, redirect to dashboard if not
     */
    requireSelected() {
        if (!this.getSelectedId()) {
            window.location.href = 'dashboard.html';
            return false;
        }
        return true;
    }
};

// ---- API Helpers ----
const API = {
    /**
     * Get auth headers
     */
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = Auth.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    },
    
    /**
     * Make API request
     */
    async request(endpoint, options = {}) {
        const url = `${LEENA.API_BASE}${endpoint}`;
        const config = {
            headers: this.getHeaders(),
            ...options
        };
        
        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }
        
        try {
            const response = await fetch(url, config);
            
            // Handle 401 Unauthorized
            if (response.status === 401) {
                Auth.clearAuth();
                window.location.href = 'login.html';
                throw new Error('Session expired. Please login again.');
            }
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || data.message || 'Request failed');
            }
            
            return data;
        } catch (error) {
            console.error(`API Error (${endpoint}):`, error);
            throw error;
        }
    },
    
    /**
     * GET request
     */
    async get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    },
    
    /**
     * POST request
     */
    async post(endpoint, body) {
        return this.request(endpoint, { method: 'POST', body });
    },
    
    /**
     * PUT request
     */
    async put(endpoint, body) {
        return this.request(endpoint, { method: 'PUT', body });
    },
    
    /**
     * DELETE request
     */
    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
};

// ---- UI Helpers ----
const UI = {
    /**
     * Show loading spinner in element
     */
    showLoading(element) {
        if (typeof element === 'string') {
            element = document.getElementById(element);
        }
        if (element) {
            element.innerHTML = `
                <div class="loading-spinner">
                    <div class="spinner"></div>
                </div>
            `;
        }
    },
    
    /**
     * Show error state in element
     */
    showError(element, message, retryCallback) {
        if (typeof element === 'string') {
            element = document.getElementById(element);
        }
        if (element) {
            element.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <i class="bi bi-exclamation-circle"></i>
                    </div>
                    <h3>Error</h3>
                    <p>${this.escapeHtml(message)}</p>
                    ${retryCallback ? `
                        <button class="btn btn-primary" onclick="${retryCallback}">
                            <i class="bi bi-arrow-clockwise"></i> Try Again
                        </button>
                    ` : ''}
                </div>
            `;
        }
    },
    
    /**
     * Show empty state in element
     */
    showEmpty(element, icon, title, message, actionHtml = '') {
        if (typeof element === 'string') {
            element = document.getElementById(element);
        }
        if (element) {
            element.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <i class="bi bi-${icon}"></i>
                    </div>
                    <h3>${title}</h3>
                    <p>${message}</p>
                    ${actionHtml}
                </div>
            `;
        }
    },
    
    /**
     * Show toast notification
     */
    toast(message, type = 'info', duration = 3000) {
        // Remove existing toasts
        const existing = document.querySelector('.toast-container');
        if (existing) existing.remove();
        
        const container = document.createElement('div');
        container.className = 'toast-container';
        container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999;';
        
        const icons = {
            success: 'check-circle-fill',
            error: 'exclamation-circle-fill',
            warning: 'exclamation-triangle-fill',
            info: 'info-circle-fill'
        };
        
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#0066ff'
        };
        
        const toast = document.createElement('div');
        toast.style.cssText = `
            background: ${colors[type] || colors.info};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideIn 0.3s ease-out;
        `;
        toast.innerHTML = `
            <i class="bi bi-${icons[type] || icons.info}"></i>
            <span>${this.escapeHtml(message)}</span>
        `;
        
        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { opacity: 0; transform: translateX(100%); }
                to { opacity: 1; transform: translateX(0); }
            }
            @keyframes slideOut {
                from { opacity: 1; transform: translateX(0); }
                to { opacity: 0; transform: translateX(100%); }
            }
        `;
        document.head.appendChild(style);
        
        container.appendChild(toast);
        document.body.appendChild(container);
        
        // Auto remove
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-out forwards';
            setTimeout(() => container.remove(), 300);
        }, duration);
    },
    
    /**
     * Confirm dialog
     */
    confirm(message) {
        return window.confirm(message);
    },
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Format date
     */
    formatDate(dateStr, options = {}) {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            ...options
        });
    },
    
    /**
     * Format date and time
     */
    formatDateTime(dateStr) {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },
    
    /**
     * Format number with commas
     */
    formatNumber(num) {
        if (num === null || num === undefined) return '0';
        return num.toLocaleString();
    },
    
    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.toast('Copied to clipboard!', 'success');
            return true;
        } catch (err) {
            console.error('Failed to copy:', err);
            this.toast('Failed to copy', 'error');
            return false;
        }
    },
    
    /**
     * Set active menu item
     */
    setActiveMenu(selector) {
        document.querySelectorAll('.sidebar-menu a').forEach(a => {
            a.classList.remove('active');
        });
        const active = document.querySelector(selector);
        if (active) {
            active.classList.add('active');
        }
    }
};

// ---- Sidebar Component ----
const Sidebar = {
    /**
     * Render sidebar HTML
     */
    render(activePage = '') {
        const expoId = Expo.getSelectedId();
        const expoName = Expo.getSelectedName() || 'Select Expo';
        const hasExpo = !!expoId;
        
        return `
            <nav class="sidebar">
                <div class="sidebar-header">
                    <img src="assets/Leena_logo_white.png" alt="Leena" class="sidebar-logo">
                </div>
                
                ${hasExpo ? `
                    <div class="sidebar-section-title" style="padding: 12px 16px; color: #666;">
                        <i class="bi bi-calendar-event"></i> ${UI.escapeHtml(expoName)}
                    </div>
                ` : ''}
                
                <ul class="sidebar-menu">
                    ${hasExpo ? `
                        <li><a href="main-panel.html" class="${activePage === 'dashboard' ? 'active' : ''}">
                            <i class="bi bi-speedometer2"></i> Dashboard
                        </a></li>
                        <li><a href="visitorlog-paginated.html" class="${activePage === 'visitors' ? 'active' : ''}">
                            <i class="bi bi-people"></i> Visitors
                        </a></li>
                        <li><a href="form-builder.html" class="${activePage === 'forms' ? 'active' : ''}">
                            <i class="bi bi-card-list"></i> Forms
                        </a></li>
                        <li><a href="checkins.html" class="${activePage === 'checkins' ? 'active' : ''}">
                            <i class="bi bi-check2-square"></i> Check-ins
                        </a></li>
                        <li><a href="terminals.html" class="${activePage === 'terminals' ? 'active' : ''}">
                            <i class="bi bi-pc-display"></i> Terminals
                        </a></li>
                        
                        <div class="sidebar-divider"></div>
                        <div class="sidebar-section-title">Communication</div>
                        
                        <li><a href="email-templates.html" class="${activePage === 'email-templates' ? 'active' : ''}">
                            <i class="bi bi-envelope"></i> Email Templates
                        </a></li>
                        <li><a href="email-segments.html" class="${activePage === 'email-segments' ? 'active' : ''}">
                            <i class="bi bi-megaphone"></i> Email Segments
                        </a></li>
                        
                        <div class="sidebar-divider"></div>
                        <div class="sidebar-section-title">Data</div>
                        
                        <li><a href="reports.html" class="${activePage === 'reports' ? 'active' : ''}">
                            <i class="bi bi-graph-up"></i> Reports
                        </a></li>
                        <li><a href="import.html" class="${activePage === 'import' ? 'active' : ''}">
                            <i class="bi bi-download"></i> Import
                        </a></li>
                    ` : `
                        <li><a href="dashboard.html" class="active">
                            <i class="bi bi-collection"></i> My Expos
                        </a></li>
                    `}
                    
                    <div class="sidebar-divider"></div>
                    
                    ${hasExpo ? `
                        <li><a href="dashboard.html">
                            <i class="bi bi-arrow-left-circle"></i> Change Expo
                        </a></li>
                    ` : ''}
                    
                    <li><a href="#" onclick="Auth.logout(); return false;">
                        <i class="bi bi-box-arrow-right"></i> Logout
                    </a></li>
                </ul>
            </nav>
        `;
    },
    
    /**
     * Initialize sidebar in page
     */
    init(activePage) {
        const container = document.getElementById('sidebar-container');
        if (container) {
            container.innerHTML = this.render(activePage);
        }
    }
};

// ---- Page Header Component ----
const PageHeader = {
    /**
     * Render page header
     */
    render(title, icon = '', actions = '') {
        return `
            <header class="main-header">
                <h1>
                    ${icon ? `<i class="bi bi-${icon}"></i>` : ''}
                    <span>${UI.escapeHtml(title)}</span>
                </h1>
                <div class="header-actions">
                    ${actions}
                </div>
            </header>
        `;
    }
};

// ---- Initialize Common Features ----
document.addEventListener('DOMContentLoaded', () => {
    // Add Inter font
    if (!document.querySelector('link[href*="Inter"]')) {
        const fontLink = document.createElement('link');
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
        fontLink.rel = 'stylesheet';
        document.head.appendChild(fontLink);
    }
    
    // Add Bootstrap Icons if not present
    if (!document.querySelector('link[href*="bootstrap-icons"]')) {
        const iconsLink = document.createElement('link');
        iconsLink.href = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css';
        iconsLink.rel = 'stylesheet';
        document.head.appendChild(iconsLink);
    }
});

// Export for ES modules (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LEENA, Auth, Expo, API, UI, Sidebar, PageHeader };
}
