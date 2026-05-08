/**
 * Leena Toast — Shared notification component
 * Usage: <script src="/leena-toast.js"></script>
 * API:   showToast(message, type)
 *        type: 'success' (default) | 'error' | 'info' | 'warning'
 */
(function () {
  // Inject CSS once
  if (!document.getElementById('leena-toast-style')) {
    const style = document.createElement('style');
    style.id = 'leena-toast-style';
    style.textContent = `
      .app-toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 99999; pointer-events: none; }
      .app-toast { pointer-events: auto; background: #10b981; color: white; padding: 12px 20px; border-radius: 8px; margin-top: 8px; display: flex; align-items: center; gap: 8px; font-size: 14px; font-family: 'Inter', system-ui, sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.15); animation: appToastSlideIn 0.3s forwards; }
      .app-toast-error { background: #ef4444; }
      .app-toast-warning { background: #f59e0b; }
      .app-toast-info { background: #3b82f6; }
      @keyframes appToastSlideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    `;
    document.head.appendChild(style);
  }

  // Ensure container exists
  function getContainer() {
    let c = document.getElementById('toastContainer');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toastContainer';
      c.className = 'app-toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  const ICONS = {
    success: 'check-circle',
    error: 'exclamation-circle',
    warning: 'exclamation-triangle',
    info: 'info-circle'
  };

  window.showToast = function (msg, type, duration) {
    type = type || 'success';
    duration = duration || 4000;
    const toast = document.createElement('div');
    toast.className = 'app-toast' + (type !== 'success' ? ' app-toast-' + type : '');
    toast.innerHTML = '<i class="bi bi-' + (ICONS[type] || ICONS.success) + '"></i> ' + msg;
    getContainer().appendChild(toast);
    setTimeout(function () { toast.remove(); }, duration);
  };
})();
