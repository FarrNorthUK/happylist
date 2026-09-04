// ── Version comparison (pure) ──

export function isDevVersion(version) {
  return version === 'dev';
}

export function needsUpdate(current, remote) {
  return Boolean(remote) && remote !== current;
}

// ── Checker (seam: fetchVersion injected) ──

export function createUpdateChecker({ currentVersion, fetchVersion }) {
  async function check() {
    if (isDevVersion(currentVersion)) {
      return { ok: true, updateAvailable: false, skipped: true };
    }
    try {
      const remote = await fetchVersion();
      return { ok: true, updateAvailable: needsUpdate(currentVersion, remote), remote };
    } catch (err) {
      console.warn('[update-check]', err);
      return { ok: false, error: err };
    }
  }
  return { check };
}

// ── Network transport (production) ──

export async function fetchVersionFromNetwork() {
  const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'reload' });
  if (!res.ok) throw new Error(`version.json: ${res.status}`);
  const { version } = await res.json();
  return version ?? null;
}
