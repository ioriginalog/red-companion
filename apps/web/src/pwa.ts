/**
 * Service worker registration (production builds only) with an update prompt:
 * when a new build has installed and is waiting, offer a reload instead of
 * swapping code under a live game.
 */
declare const __BUILD_ID__: string;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__BUILD_ID__)}`).then((reg) => {
      const offer = (w: ServiceWorker | null) => { if (w && navigator.serviceWorker.controller) showUpdatePrompt(w); };
      offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
      });
    }).catch(() => { /* offline support is a bonus, never a blocker */ });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  });
}

function showUpdatePrompt(worker: ServiceWorker) {
  if (document.getElementById('nsc-update')) return;
  const bar = document.createElement('div');
  bar.id = 'nsc-update';
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed', 'left:50%', 'top:12px', 'transform:translateX(-50%)', 'z-index:50', 'display:flex', 'gap:10px', 'align-items:center',
    'background:var(--panel,#0b1230)', 'border:1px solid var(--cyan,#22e3ff)', 'color:var(--text,#dce6ff)', 'padding:8px 12px',
    'font:600 14px var(--head,sans-serif)', 'text-transform:uppercase', 'letter-spacing:0.06em', 'box-shadow:0 6px 30px rgba(0,0,0,0.6)',
  ].join(';');
  const label = document.createElement('span');
  label.textContent = 'Update Available';
  const go = document.createElement('button');
  go.className = 'btn yellow';
  go.textContent = 'Reload';
  go.addEventListener('click', () => worker.postMessage('skipWaiting'));
  const later = document.createElement('button');
  later.className = 'btn ghost';
  later.textContent = 'Later';
  later.addEventListener('click', () => bar.remove());
  bar.append(label, go, later);
  document.body.append(bar);
}
