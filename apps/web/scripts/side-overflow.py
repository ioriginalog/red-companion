#!/usr/bin/env python3
"""
Side panel overflow check: nothing in the Table's side panel may scroll or
stick out sideways, on any tab, for the GM and a player.

  npm run build && python3 apps/web/scripts/side-overflow.py

Starts its own relay on a free port (temporary data dir), loads the demo
encounter, starts it, and for 1600 x 1000 and 1280 x 800 checks every tab:
  - .side-body scrollWidth <= clientWidth
  - no visible descendant's right edge passes the panel's right edge
Exits 1 and lists the offenders on failure.
"""
import os, shutil, signal, socket, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
SIZES = [(1600, 1000), (1280, 800)]

PROBE = """() => {
  const side = document.querySelector('.side-body');
  if (!side) return { missing: true };
  const box = side.getBoundingClientRect();
  const out = [];
  for (const el of side.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.position === 'fixed') continue;
    if (r.right > box.right + 0.5) {
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40);
      out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')} "${label}" right ${Math.round(r.right)} > ${Math.round(box.right)}`);
    }
  }
  return { scroll: side.scrollWidth, client: side.clientWidth, out: out.slice(0, 8) };
}"""

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

def main():
    data = tempfile.mkdtemp(prefix='nsc-overflow-')
    port = free_port()
    env = dict(os.environ, PORT=str(port), HOST='127.0.0.1', DATA_DIR=data)
    relay = subprocess.Popen(['node', 'apps/relay/dist/server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    base = f'http://127.0.0.1:{port}'
    problems = []
    try:
        for _ in range(100):
            try: urllib.request.urlopen(f'{base}/health', timeout=0.5); break
            except Exception: time.sleep(0.1)
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            def ctx():
                c = b.new_context(service_workers='block', viewport={'width': 1600, 'height': 1000})
                c.add_init_script("try { localStorage.setItem('nsc.e2e', '1'); } catch (e) {}")
                return c
            gm = ctx().new_page()
            gm.goto(base); gm.wait_for_load_state('networkidle')
            gm.get_by_role('button', name='Create a New Session').click()
            gm.wait_for_function("() => { const s = window.__nsc?.getState(); return s && s.role === 'gm' && s.status === 'online' && !!s.joinCode }", timeout=15000)
            code = gm.evaluate('() => window.__nsc.getState().joinCode')
            gm.get_by_role('button', name='Load Demo Encounter').click()
            gm.wait_for_function('() => !!window.__nsc.getState().view.map', timeout=15000)
            pl = ctx().new_page()
            pl.goto(f'{base}/?join={code}')
            pl.wait_for_function('() => !!window.__nsc', timeout=15000)
            pl.get_by_label('Your name').fill('Ana')
            pl.get_by_role('button', name='Join', exact=True).click()
            pl.wait_for_function("() => { const s = window.__nsc.getState(); return s.status === 'online' && !!s.playerId }", timeout=15000)
            pid = pl.evaluate('() => window.__nsc.getState().playerId')
            gm.evaluate("(pid) => window.__nsc.act({ type: 'assignController', actorId: 'vex', controller: pid })", pid)
            ids = ['vex', 'doc', 'kestrel', 'rook', 'lt', 'ganger-a', 'ganger-b', 'enforcer', 'drone']
            gm.evaluate("(ids) => window.__nsc.act({ type: 'startEncounter', participants: ids.map((actorId) => ({ actorId })) })", ids)
            time.sleep(0.8)
            for who, page in (('GM', gm), ('Player', pl)):
                for (w, h) in SIZES:
                    page.set_viewport_size({'width': w, 'height': h}); time.sleep(0.4)
                    tabs = page.locator('.side .tabs [role=tab]')
                    for i in range(tabs.count()):
                        t = tabs.nth(i)
                        name = t.inner_text().strip().split('\n')[0]
                        if t.get_attribute('aria-selected') != 'true': t.click()
                        time.sleep(0.35)
                        r = page.evaluate(PROBE)
                        if r.get('missing'): continue
                        bad = r['scroll'] > r['client'] or r['out']
                        print(f"  {'FAIL' if bad else 'ok  '} {who} {w}x{h} {name}: scrollWidth {r['scroll']} / clientWidth {r['client']}")
                        if bad: problems.append(f"{who} {w}x{h} {name}: " + '; '.join(r['out'] or ['scrollWidth > clientWidth']))
                    tabs.nth(0).click()
            b.close()
    finally:
        relay.send_signal(signal.SIGTERM)
        try: relay.wait(5)
        except subprocess.TimeoutExpired: relay.kill()
        shutil.rmtree(data, ignore_errors=True)
    if problems:
        print('\nSide panel overflow:')
        for p in problems: print('  ' + p)
        sys.exit(1)
    print('Side panel fits at every size.')

if __name__ == '__main__':
    main()
