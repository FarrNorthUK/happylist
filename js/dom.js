// Shared DOM-building helpers (pure, tested in Node).

export function esc(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function storeBg(store) {
  return store.colour2
    ? `linear-gradient(135deg, ${store.colour} 50%, ${store.colour2} 50%)`
    : store.colour;
}
