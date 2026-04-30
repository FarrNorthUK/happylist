const views = ['list', 'shop', 'settings'];

let onNavigateCallbacks = {};

export function initRouter() {
  window.addEventListener('hashchange', applyHash);
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
  applyHash();
}

export function navigate(view) {
  if (!views.includes(view)) view = 'list';
  history.replaceState(null, '', `#${view}`);
  applyHash();
}

function applyHash() {
  const hash = location.hash.replace('#', '') || 'list';
  const view = views.includes(hash) ? hash : 'list';

  document.querySelectorAll('.view').forEach(el => {
    el.classList.toggle('active', el.id === `view-${view}`);
  });
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  onNavigateCallbacks[view]?.();
}

export function onNavigate(view, fn) {
  onNavigateCallbacks[view] = fn;
}
