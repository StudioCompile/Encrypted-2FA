(function () {
  var KEY = 'vault.theme', root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function pref() { try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; } }
  function apply() {
    var p = pref();
    root.setAttribute('data-theme', p === 'system' ? (mq && mq.matches ? 'dark' : 'light') : p);
  }
  window.VaultTheme = {
    get: pref,
    set: function (v) { try { localStorage.setItem(KEY, v); } catch (e) {} apply(); }
  };
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (pref() === 'system') apply(); });
  apply();
})();
