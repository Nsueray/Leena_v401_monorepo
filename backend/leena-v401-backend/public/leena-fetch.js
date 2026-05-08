/**
 * Leena Fetch — Shared authenticated fetch wrapper
 * Usage: <script src="/leena-fetch.js"></script> (after leena-toast.js)
 * API:   leenaFetch(url, options) — returns Promise<Response>
 *
 * Features:
 * - Auto-attaches Authorization header from localStorage token
 * - 401/403 response → auto-logout + redirect to login.html
 * - 15s timeout via AbortController (caller handles error toast)
 * - Concurrent 401 protection (single logout, not 5x)
 * - All non-auth errors thrown to caller for contextual handling
 */
(function () {
  var TIMEOUT_MS = 15000;
  var _loggingOut = false;

  function notify(msg, type) {
    if (typeof showToast === 'function') {
      showToast(msg, type);
    } else {
      console.error('[leena-fetch] ' + msg);
    }
  }

  function logout() {
    localStorage.removeItem('token');
    if (window.location.pathname.indexOf('login') === -1) {
      window.location.href = 'login.html';
    }
  }

  window.leenaFetch = function (url, options) {
    options = options || {};

    // Auto-attach Authorization header
    var token = localStorage.getItem('token');
    if (token) {
      options.headers = options.headers || {};
      if (typeof options.headers.set === 'function') {
        if (!options.headers.has('Authorization')) {
          options.headers.set('Authorization', 'Bearer ' + token);
        }
      } else {
        if (!options.headers['Authorization']) {
          options.headers['Authorization'] = 'Bearer ' + token;
        }
      }
    }

    // Timeout via AbortController
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    if (!options.signal) {
      options.signal = controller.signal;
    }

    return fetch(url, options)
      .then(function (res) {
        clearTimeout(timeoutId);

        // Auto-logout on 401 (once — concurrent protection)
        if (res.status === 401 || res.status === 403) {
          if (!_loggingOut) {
            _loggingOut = true;
            notify('Session expired. Please log in again.', 'error');
            setTimeout(logout, 1500);
          }
          var err = new Error('Unauthorized');
          err.status = 401;
          throw err;
        }

        return res;
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        // 401/403 already notified above; pass through.
        // For all other errors (timeout, network, etc.), caller is
        // responsible for showing contextual error message.
        throw err;
      });
  };
})();
