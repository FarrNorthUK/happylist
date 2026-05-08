let _resolve = null;

export function showConfirm(message, { confirmText = 'OK', cancelText = 'Cancel', thirdText = null, danger = false } = {}) {
  return new Promise(resolve => {
    _resolve = resolve;
    document.getElementById('confirm-message').textContent = message;
    const okBtn = document.getElementById('btn-confirm-ok');
    okBtn.textContent = confirmText;
    okBtn.className = danger ? 'danger-btn' : 'primary-btn';
    document.getElementById('btn-confirm-cancel').textContent = cancelText;
    const thirdBtn = document.getElementById('btn-confirm-third');
    if (thirdText) {
      thirdBtn.textContent = thirdText;
      thirdBtn.classList.add('visible');
    } else {
      thirdBtn.classList.remove('visible');
    }
    document.getElementById('modal-confirm').classList.remove('hidden');
  });
}

function closeConfirm(result) {
  document.getElementById('modal-confirm').classList.add('hidden');
  document.getElementById('btn-confirm-third').classList.remove('visible');
  if (_resolve) { _resolve(result); _resolve = null; }
}

document.getElementById('btn-confirm-ok').onclick     = () => closeConfirm(true);
document.getElementById('btn-confirm-cancel').onclick = () => closeConfirm(false);
document.getElementById('confirm-backdrop').onclick   = () => closeConfirm(false);
document.getElementById('btn-confirm-third').onclick  = () => closeConfirm('abandon');
