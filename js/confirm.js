let _resolve = null;

export function showConfirm(message, { confirmText = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    _resolve = resolve;
    document.getElementById('confirm-message').textContent = message;
    const okBtn = document.getElementById('btn-confirm-ok');
    okBtn.textContent = confirmText;
    okBtn.className = danger ? 'danger-btn' : 'primary-btn';
    document.getElementById('modal-confirm').classList.remove('hidden');
  });
}

function closeConfirm(result) {
  document.getElementById('modal-confirm').classList.add('hidden');
  if (_resolve) { _resolve(result); _resolve = null; }
}

document.getElementById('btn-confirm-ok').onclick     = () => closeConfirm(true);
document.getElementById('btn-confirm-cancel').onclick = () => closeConfirm(false);
document.getElementById('confirm-backdrop').onclick   = () => closeConfirm(false);
