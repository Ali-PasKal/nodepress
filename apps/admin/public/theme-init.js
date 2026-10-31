// Applies the persisted colour theme before React mounts to avoid a light/dark flash.
// Must stay in sync with the storage key and shape used by src/stores/theme-store.ts.
(function () {
  try {
    var raw = window.localStorage.getItem('nexora.admin.theme');
    var stored = raw ? JSON.parse(raw) : null;
    var preference = stored && stored.state ? stored.state.preference : 'system';
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = preference === 'dark' || (preference !== 'light' && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
  } catch {
    // Storage unavailable (e.g. blocked cookies): keep the default light theme.
  }
})();
