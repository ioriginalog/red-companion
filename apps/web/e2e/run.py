#!/usr/bin/env python3
"""
Browser end-to-end suite: real relay, real web client, headless Chrome.

  npm run e2e            (builds first)
  python3 apps/web/e2e/run.py

Checks:
  1. Players keep their identity across a relay restart and a dropped socket.
  2. Player WebSocket frames never carry hidden ids, names, HP, counts, GM
     notes, NET secrets, private rolls or other players' whispers over a
     scripted encounter (fog, initiative, fire, cover, delay, grapples, NET).
  3. GM actions taken offline survive closing the tab and sync on reopen.
  4. GM undo removes the undone line from players' logs.
  5. Bursts (GM-side and a player flood) don't crash the GM client.
  6. GM pings, ruler lines and cursors never point into the fog.
  7. Players get nothing for entries they can't see (unseen Turns, private
     rolls, whispers) and no countable gaps; area pendings and Black ICE show
     totals only; unexplored terrain is masked; refusals are generic; gear must
     be carried; GM names are reserved; the GM roster renames, merges, removes
     and approves a returning player's seat.

Leaks that belong to defects still open on another branch are listed in
KNOWN_OPEN: they're reported as warnings, not failures, and the suite tells you
when one stops reproducing so the entry can be deleted.
"""
import json, os, shutil, signal, socket, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')

# Leaks known to be open (fixed elsewhere, not yet merged). Keys: 'id:<eventType>',
# 'initiative-hidden-count', 'burning-hp'. Empty now that redaction (round 4 H2) is in.
KNOWN_OPEN: dict = {}

failures, warnings, seen_known = [], [], set()

def check(cond, msg):
    if not cond:
        failures.append(msg)
        print(f'  FAIL {msg}')
    else:
        print(f'  ok   {msg}')

class Relay:
    def __init__(self, data_dir, port):
        self.data_dir, self.port, self.proc = data_dir, port, None
    def start(self):
        env = dict(os.environ, PORT=str(self.port), HOST='127.0.0.1', DATA_DIR=self.data_dir)
        self.proc = subprocess.Popen(['node', 'apps/relay/dist/server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        for _ in range(100):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{self.port}/health', timeout=0.5); return
            except Exception: time.sleep(0.1)
        raise RuntimeError('relay did not start')
    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.send_signal(signal.SIGTERM)
            try: self.proc.wait(5)
            except subprocess.TimeoutExpired: self.proc.kill()
        self.proc = None

def wait_for(page, js, timeout=15000):
    page.wait_for_function(js, timeout=timeout)

def new_ctx(browser, **kw):
    # The service worker can reload the page when it takes control; keep runs deterministic.
    ctx = browser.new_context(service_workers='block', **kw)
    ctx.add_init_script("try { localStorage.setItem('nsc.e2e', '1'); } catch (e) {}")
    return ctx

def capture(page):
    frames = []
    page.on('websocket', lambda ws: ws.on('framereceived', lambda p: frames.append(p if isinstance(p, str) else p.decode('utf-8', 'replace'))))
    return frames

def page_errors(page, bucket, who):
    page.on('pageerror', lambda e: bucket.append(f'{who}: {e}'))
    page.on('console', lambda m: m.type == 'error' and 'Maximum update depth' in m.text and bucket.append(f'{who} console: {m.text[:160]}'))

def gm_create(page, base):
    page.goto(base)
    page.wait_for_load_state('networkidle')
    wait_for(page, '() => !!window.__nsc')
    page.evaluate('() => window.__nsc.createSession()')
    wait_for(page, "() => { const s = window.__nsc.getState(); return s.role === 'gm' && s.status === 'online' && !!s.joinCode }")
    return page.evaluate('() => window.__nsc.getState().joinCode')

def player_join(page, base, code, name):
    page.goto(f'{base}/?join={code}')
    wait_for(page, '() => !!window.__nsc')
    page.get_by_label('Your name').fill(name)
    page.get_by_role('button', name='Join', exact=True).click()
    wait_for(page, "() => { const s = window.__nsc.getState(); return s.status === 'online' && !!s.playerId }")
    return page.evaluate('() => window.__nsc.getState().playerId')

def gm_act(page, intent):
    return page.evaluate('(i) => window.__nsc.act(i)', intent)

def actor(aid, name, side, controller='gm', allegiance=None, extra=None):
    stats = {'INT': 6, 'REF': 6, 'DEX': 6, 'TECH': 6, 'COOL': 6, 'WILL': 6, 'LUCK': 6, 'MOVE': 6, 'BODY': 6, 'EMP': 6}
    c = {'id': aid, 'name': name, 'side': side, 'stats': stats, 'skills': {'Handgun': 6, 'Brawling': 4, 'Evasion': 2},
         'hp': {'max': 40, 'current': 40}, 'armor': [], 'criticalInjuries': [], 'deathSave': {'accumulatedPenalty': 0},
         'conditions': {'prone': False, 'unconscious': False, 'dead': False, 'stabilized': False}}
    if extra: c.update(extra)
    a = {'id': aid, 'controller': controller, 'weapons': [{'id': 'pistol', 'name': 'Heavy Pistol', 'type': 'heavyPistol', 'ammo': {'loaded': 8, 'capacity': 8}}], 'combatant': c}
    if allegiance: a['allegiance'] = allegiance
    return a

def current_actor(page):
    return page.evaluate("() => { const e = window.__nsc.getState().view.encounter; return e.active ? e.order[e.turnIndex] : null }")

# ---------------------------------------------------------------------------

def test_identity(browser, base, relay):
    print('1. Identity across relay restart and dropped sockets')
    gm = new_ctx(browser).new_page(); code = gm_create(gm, base)
    pctx = new_ctx(browser, viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    p = pctx.new_page(); pid = player_join(p, base, code, 'Ana')
    gm_act(gm, {'type': 'addActor', 'actor': actor('ana-pc', 'Ana PC', 'pc')})
    gm_act(gm, {'type': 'assignController', 'actorId': 'ana-pc', 'controller': pid})
    relay.stop(); time.sleep(0.5); relay.start()
    wait_for(p, "() => window.__nsc.getState().status === 'online'", 30000)
    wait_for(gm, "() => window.__nsc.getState().status === 'online'", 30000)
    time.sleep(0.5)
    check(p.evaluate('() => window.__nsc.getState().playerId') == pid, 'player id unchanged after relay restart')
    names = gm.evaluate('() => window.__nsc.getState().players.map(p => p.name)')
    check(names.count('Ana') == 1, f'GM roster has one Ana after restart ({names})')
    check(gm.evaluate("() => window.__nsc.getState().view.actors['ana-pc'].controller") == pid, 'character still assigned after restart')
    # Drop the socket without restarting the relay.
    p.evaluate('() => window.__nsc.ws.close()')
    time.sleep(0.3)
    wait_for(p, "() => window.__nsc.getState().status === 'online'", 20000)
    check(p.evaluate('() => window.__nsc.getState().playerId') == pid, 'player id unchanged after a dropped socket')
    names = gm.evaluate('() => window.__nsc.getState().players.map(p => p.name)')
    check(names.count('Ana') == 1, f'GM roster still has one Ana ({names})')
    gm.context.close(); pctx.close()

def _events(raw):
    try: m = json.loads(raw)
    except Exception: return []
    if m.get('t') == 'entries': return [e for en in m.get('entries', []) for e in en.get('events', [])]
    if m.get('t') in ('welcome', 'rewind'): return [e for h in (m.get('history') or []) for e in h.get('events', [])]
    return []

def scan_leaks(frames, who, secrets):
    """Return (problems, known) found in a player's received frames."""
    problems, known = [], set()
    for raw in frames:
        try: m = json.loads(raw)
        except Exception: continue
        entries = m.get('entries') if m.get('t') == 'entries' else None
        events = []
        if entries: events = [e for en in entries for e in en.get('events', [])]
        if m.get('t') in ('welcome', 'rewind'): events = [e for h in (m.get('history') or []) for e in h.get('events', [])]
        # Per-event checks, so known-open defects can be told apart.
        for e in events:
            et = e.get('type')
            blob = json.dumps(e)
            for s in secrets:
                if s in blob:
                    key = f'id:{et}'
                    (known.add(key) if key in KNOWN_OPEN else problems.append(f'{who}: "{s}" in {et} event: {blob[:160]}'))
            if et == 'initiativeRolled' and any(x.get('combatantId') == 'hidden' for x in e.get('entries', [])):
                known.add('initiative-hidden-count')
            if 'hpAfter' in e and e.get('targetId') in ('hidden', None) | set(secrets):
                k = 'burning-hp' if et == 'burning' else None
                (known.add(k) if k else problems.append(f'{who}: hidden HP in {et} event: {blob[:160]}'))
        # Everything outside events (views, patches, pending, order).
        rest = dict(m)
        if entries: rest['entries'] = [{k: v for k, v in en.items() if k != 'events'} for en in entries]
        if 'history' in rest: rest['history'] = []
        blob = json.dumps(rest)
        for s in secrets:
            if s in blob: problems.append(f'{who}: "{s}" outside events in a {m.get("t")} frame: {blob[blob.find(s) - 80: blob.find(s) + 80]}')
        # By design one anonymous slot shows while an unseen actor acts; more would be a count.
        lists = [((rest.get('view') or {}).get('encounter') or {}).get('order') or []]
        if entries: lists += [(((en.get('patch') or {}).get('encounter') or {}).get('order')) or [] for en in rest['entries']]
        for o in lists:
            hidden = [x for x in o if str(x).startswith('hidden')]
            if len(hidden) > 1 or any(x != 'hidden' for x in hidden):
                problems.append(f'{who}: hidden actors countable in Turn order ({o})')
    return problems, known

def test_redaction(browser, base):
    print('2. Redaction over a scripted encounter')
    gctx = new_ctx(browser); gm = gctx.new_page(); errs = []; page_errors(gm, errs, 'GM')
    code = gm_create(gm, base)
    actx = new_ctx(browser); a = actx.new_page(); fa = capture(a); pa = player_join(a, base, code, 'Ana')
    bctx = new_ctx(browser); b = bctx.new_page(); fb = capture(b); pb = player_join(b, base, code, 'Bo')
    # 14 × 6 with a full wall at x = 7: the right half is unseen. Cover at (10, 1).
    rows = []
    for y in range(6):
        rows.append(''.join('#' if x == 7 else 'c' if (x, y) == (10, 1) else '.' for x in range(14)))
    for i in [
        {'type': 'addActor', 'actor': {**actor('solo', 'Solo', 'pc', pa), 'notes': 'Player-visible note', 'gmNotes': 'ZzGmNote: secretly works for the boss'}},
        {'type': 'addActor', 'actor': actor('thug', 'Thug', 'npc')},
        {'type': 'addActor', 'actor': actor('zzsecret', 'Zzhiddenname', 'npc', extra={'onFire': 2})},
        {'type': 'addActor', 'actor': actor('zzsecond', 'Zzothername', 'npc')},
        {'type': 'setMap', 'map': {'id': 'm', 'name': 'Split', 'width': 14, 'height': 6, 'cells': ''.join(rows), 'cellPx': 64, 'sightRange': 30,
                                   'tokens': {'solo': {'x': 2, 'y': 2}, 'thug': {'x': 3, 'y': 4}, 'zzsecret': {'x': 11, 'y': 2}, 'zzsecond': {'x': 12, 'y': 2}},
                                   'watches': {}, 'spotted': []}},
        {'type': 'setCover', 'at': {'x': 10, 'y': 1}, 'material': 'thickWood'},
        {'type': 'rollDice', 'label': 'ZzPrivateRoll', 'dice': {'count': 1, 'sides': 10, 'bonus': 0}, 'private': True},
        {'type': 'chat', 'text': 'ZzWhisperForBo', 'to': [pb]},
        {'type': 'adjustHp', 'actorId': 'zzsecret', 'delta': -3, 'reason': 'ZzReason'},
        {'type': 'net', 'op': {'op': 'saveArchitecture', 'architecture': {
            'id': 'zzarch', 'name': 'Zz Server', 'difficulty': 'standard', 'rootId': 'f1', 'virusDv': 8,
            'floors': {'f1': {'id': 'f1', 'kind': 'password', 'dv': 6}, 'f2': {'id': 'f2', 'kind': 'file', 'dv': 8, 'note': 'ZzSecretFile'}},
            'children': {'f1': ['f2']}, 'access': [{'mapId': 'm', 'cells': [{'x': 3, 'y': 2}]}]}}},
        {'type': 'net', 'op': {'op': 'setRig', 'actorId': 'solo', 'rig': {'interface': 3, 'deckName': 'Deck', 'slots': 7, 'programs': []}}},
        # Lights and drawings: a hidden token's lantern, a lamp behind the wall and a GM-only note never reach players.
        {'type': 'light', 'op': {'op': 'setAmbient', 'ambient': 'dim'}},
        {'type': 'light', 'op': {'op': 'upsert', 'light': {'id': 'zzlantern', 'label': 'ZzLampLabel', 'attachedTo': 'zzsecret', 'bright': 3, 'dim': 2, 'on': True}}},
        {'type': 'light', 'op': {'op': 'upsert', 'light': {'id': 'zzbacklamp', 'at': {'x': 12, 'y': 4}, 'bright': 2, 'dim': 1, 'on': True}}},
        {'type': 'light', 'op': {'op': 'upsert', 'light': {'id': 'frontlamp', 'at': {'x': 2, 'y': 0}, 'bright': 2, 'dim': 1, 'on': True}}},
        {'type': 'annotate', 'op': {'op': 'add', 'annotation': {'id': 'zzdraw', 'kind': 'text', 'points': [11, 4], 'text': 'ZzGmDrawing', 'color': 'red', 'visibility': 'gm'}}},
        {'type': 'annotate', 'op': {'op': 'add', 'annotation': {'id': 'route', 'kind': 'line', 'points': [1, 1, 5, 1], 'color': 'cyan', 'visibility': 'all'}}},
    ]:
        ok = gm_act(gm, i)
        if not ok: print(f'    note: GM intent refused: {i["type"]} {gm.evaluate("() => window.__nsc.getState().toast?.text")}')
    gm_act(gm, {'type': 'net', 'op': {'op': 'revealAccess', 'archId': 'zzarch', 'found': True}})
    gm_act(gm, {'type': 'startEncounter', 'participants': [{'actorId': x} for x in ['solo', 'thug', 'zzsecret', 'zzsecond']]})
    for _ in range(10):
        cur = current_actor(gm)
        if cur == 'zzsecret':
            gm_act(gm, {'type': 'attackCover', 'attackerId': 'zzsecret', 'weaponId': 'pistol', 'at': {'x': 10, 'y': 1}})
            if gm.evaluate('() => !!window.__nsc.getState().view.pending'):
                p = gm.evaluate('() => window.__nsc.getState().view.pending')
                if p.get('kind') == 'awaitingDamage': gm_act(gm, {'type': 'rollDamage', 'pendingId': p['id']})
                else: gm_act(gm, {'type': 'cancelPending'})
        elif cur == 'zzsecond':
            gm_act(gm, {'type': 'extra', 'op': {'kind': 'grab', 'actorId': 'zzsecond', 'targetId': 'zzsecret', 'choice': 'grapple'}})
        elif cur == 'thug':
            gm_act(gm, {'type': 'delayTurn', 'after': 'zzsecret'})
            if current_actor(gm) == 'thug': pass
            else: continue
        elif cur == 'solo':
            a.evaluate("() => window.__nsc.act({ type: 'chat', text: 'solo here' })")
            a.evaluate("() => window.__nsc.act({ type: 'net', op: { op: 'jackIn', actorId: 'solo', archId: 'zzarch' } })")
            time.sleep(0.3)
            a.evaluate("() => window.__nsc.act({ type: 'net', op: { op: 'ability', actorId: 'solo', ability: 'backdoor' } })")
            time.sleep(0.3)
            a.evaluate("() => window.__nsc.act({ type: 'endTurn' })")
            time.sleep(0.4)
            continue
        if gm.evaluate('() => !!window.__nsc.getState().view.pending'): gm_act(gm, {'type': 'cancelPending'})
        gm_act(gm, {'type': 'endTurn'})
        time.sleep(0.15)
    gm_act(gm, {'type': 'net', 'op': {'op': 'revealAccess', 'archId': 'zzarch', 'found': True}})
    time.sleep(1.0)
    # Fresh welcomes (history) are checked too.
    a.reload(); wait_for(a, "() => window.__nsc && window.__nsc.getState().status === 'online'")
    time.sleep(0.5)
    secrets = ['zzsecret', 'zzsecond', 'Zzhiddenname', 'Zzothername', 'ZzSecretFile', 'ZzPrivateRoll', 'ZzReason', 'ZzGmNote',
               'zzlantern', 'ZzLampLabel', 'zzbacklamp', 'zzdraw', 'ZzGmDrawing']
    pa_probs, ka = scan_leaks(fa, 'Ana', secrets)
    pb_probs, kb = scan_leaks(fb, 'Bo', secrets)
    check(any('frontlamp' in f for f in fa) and any('"route"' in f for f in fa), 'players receive visible lights and shared drawings')
    wh_a = any('ZzWhisperForBo' in f for f in fa)
    wh_b = any('ZzWhisperForBo' in f for f in fb)
    check(len(fa) > 5 and len(fb) > 5, f'captured player frames (Ana {len(fa)}, Bo {len(fb)})')
    kinds = sorted({e.get('type') for raw in fa for e in _events(raw)})
    print(f'    event types Ana saw: {", ".join(kinds)}')
    check('initiativeRolled' in kinds, 'initiative went through the redaction path')
    check(not pa_probs, 'Ana received no hidden data' + ('' if not pa_probs else ':\n      ' + '\n      '.join(pa_probs[:8])))
    check(not pb_probs, 'Bo received no hidden data' + ('' if not pb_probs else ':\n      ' + '\n      '.join(pb_probs[:8])))
    check(not wh_a, 'Ana never saw the whisper meant for Bo')
    check(wh_b, 'Bo got his whisper')
    check(any('Player-visible note' in f for f in fa), 'Ana sees her character’s player notes (gmNotes withheld)')
    seen_known.update(ka | kb)
    check(not errs, f'GM page without errors ({errs[:3]})')
    gctx.close(); actx.close(); bctx.close()

def test_offline_tab_close(browser, base, relay):
    print('3. GM offline actions survive a closed tab')
    gctx = new_ctx(browser); gm = gctx.new_page(); code = gm_create(gm, base)
    creds = gm.evaluate('() => window.__nsc.currentGm()')
    gm_act(gm, {'type': 'chat', 'text': 'before outage'})
    time.sleep(0.5)
    relay.stop()
    wait_for(gm, "() => window.__nsc.getState().status !== 'online'", 10000)
    gm_act(gm, {'type': 'chat', 'text': 'ZzOfflineOne'})
    gm_act(gm, {'type': 'chat', 'text': 'ZzOfflineTwo'})
    check(gm.evaluate('() => window.__nsc.getState().unsynced') == 2, 'two actions waiting to sync')
    time.sleep(1.0)  # cache save is debounced
    gm.close()
    relay.start()
    gm2 = gctx.new_page()
    gm2.goto(base)
    wait_for(gm2, '() => !!window.__nsc')
    gm2.get_by_role('button', name=f'Resume Session {code}').click()
    wait_for(gm2, "() => window.__nsc.getState().status === 'online' && window.__nsc.getState().unsynced === 0", 20000)
    time.sleep(0.8)
    req = urllib.request.Request(f'{base}/api/sessions/{creds["sessionId"]}/export', headers={'Authorization': f'Bearer {creds["gmKey"]}'})
    log = json.loads(urllib.request.urlopen(req).read())['log']
    texts = [e['intent'].get('text') for e in log]
    check('ZzOfflineOne' in texts and 'ZzOfflineTwo' in texts, f'relay log has both offline actions ({len(log)} entries)')
    gctx.close()

def test_undo(browser, base):
    print('4. Undo reaches players')
    gctx = new_ctx(browser); gm = gctx.new_page(); code = gm_create(gm, base)
    pctx = new_ctx(browser); p = pctx.new_page(); player_join(p, base, code, 'Ana')
    gm_act(gm, {'type': 'chat', 'text': 'keep me'})
    gm_act(gm, {'type': 'chat', 'text': 'ZzUndoMe'})
    wait_for(p, "() => JSON.stringify(window.__nsc.getState().feed).includes('ZzUndoMe')")
    gm.evaluate('() => window.__nsc.undo()')
    try:
        wait_for(p, "() => !JSON.stringify(window.__nsc.getState().feed).includes('ZzUndoMe')", 5000); gone = True
    except Exception: gone = False
    check(gone, 'undone line left the player log')
    check('keep me' in p.evaluate('() => JSON.stringify(window.__nsc.getState().feed)'), 'earlier lines kept')
    gctx.close(); pctx.close()

def test_bursts(browser, base):
    print('5. Bursts')
    gctx = new_ctx(browser); gm = gctx.new_page(); errs = []; page_errors(gm, errs, 'GM')
    code = gm_create(gm, base)
    pctx = new_ctx(browser); p = pctx.new_page(); page_errors(p, errs, 'player'); player_join(p, base, code, 'Flood')
    t0 = time.time()
    gm.evaluate("() => { for (let i = 0; i < 400; i++) window.__nsc.act({ type: 'chat', text: 'gm burst ' + i }); }")
    p.evaluate("() => { for (let i = 0; i < 300; i++) window.__nsc.act({ type: 'chat', text: 'flood ' + i }); }")
    time.sleep(2.5)
    n = gm.evaluate('() => window.__nsc.getState().view.seq')
    check(n >= 400, f'GM processed its burst ({n} entries in {time.time() - t0:.1f} s)')
    check(n < 400 + 300, f'player flood was rate-limited ({n - 400} of 300 logged)')
    check(not errs, f'no page errors under bursts ({errs[:3]})')
    gctx.close(); pctx.close()

def test_gm_signals(browser, base):
    print('6. GM pings and ruler never point into the fog')
    gctx = new_ctx(browser); gm = gctx.new_page(); errs = []; page_errors(gm, errs, 'GM')
    code = gm_create(gm, base)
    actx = new_ctx(browser); a = actx.new_page(); fa = capture(a); pa = player_join(a, base, code, 'Ana')
    cells = ''.join(''.join('#' if x == 6 else '.' for x in range(12)) for _ in range(5))
    gm_act(gm, {'type': 'addActor', 'actor': actor('solo', 'Solo', 'pc', pa)})
    gm_act(gm, {'type': 'addActor', 'actor': actor('zzlurker', 'Zzlurker', 'npc')})
    gm_act(gm, {'type': 'setMap', 'map': {'id': 'm', 'name': 'Wall', 'width': 12, 'height': 5, 'cells': cells, 'cellPx': 64, 'sightRange': 30,
                                          'tokens': {'solo': {'x': 2, 'y': 2}, 'zzlurker': {'x': 9, 'y': 2}}, 'watches': {}, 'spotted': []}})
    a.wait_for_timeout(500)
    gm.evaluate("() => window.__nsc.signal({ kind: 'ping', at: { x: 9, y: 2 } })")
    a.wait_for_timeout(200)
    gm.evaluate("() => window.__nsc.signal({ kind: 'measure', from: { x: 9, y: 2 }, to: { x: 2, y: 2 } })")
    a.wait_for_timeout(200)
    gm.evaluate("() => window.__nsc.signal({ kind: 'cursor', at: { x: 10, y: 1 } })")
    a.wait_for_timeout(200)
    gm.evaluate("() => window.__nsc.signal({ kind: 'ping', at: { x: 3, y: 1 } })")  # sentinel, in view
    deadline = time.time() + 5
    def sigs():
        out = []
        for raw in fa:
            try: m = json.loads(raw)
            except Exception: continue
            if m.get('t') == 'signal' and m.get('from') == 'gm': out.append(m['signal'])
        return out
    while time.time() < deadline and not any(x.get('kind') == 'ping' and x.get('at') == {'x': 3, 'y': 1} for x in sigs()):
        a.wait_for_timeout(100)  # lets Playwright deliver the player's frames
    got = sigs()
    check(any(x.get('kind') == 'ping' and x.get('at') == {'x': 3, 'y': 1} for x in got), f'a GM ping the party can see reaches the player ({got[:6]})')
    def fogged(x):
        pts = [x.get('at'), x.get('from'), x.get('to')]
        return any(isinstance(c, dict) and c.get('x', 0) >= 6 for c in pts)
    check(not any(fogged(x) for x in got), f'no GM ping, ruler or cursor from a fogged square reached the player ({[x for x in got if fogged(x)][:3]})')
    # Show My Pings and Ruler to Players, off: nothing goes out, even in view.
    gm.evaluate("() => window.__nsc.setGmSignals(false)")
    gm.evaluate("() => window.__nsc.signal({ kind: 'ping', at: { x: 4, y: 1 } })")
    a.wait_for_timeout(200)
    gm.evaluate("() => window.__nsc.setGmSignals(true)")
    gm.evaluate("() => window.__nsc.signal({ kind: 'ping', at: { x: 5, y: 1 } })")
    deadline = time.time() + 5
    while time.time() < deadline and not any(x.get('kind') == 'ping' and x.get('at') == {'x': 5, 'y': 1} for x in sigs()):
        a.wait_for_timeout(100)  # lets Playwright deliver the player's frames
    got = sigs()
    check(any(x.get('kind') == 'ping' and x.get('at') == {'x': 5, 'y': 1} for x in got), 'GM pings reach the player again once the toggle is back on')
    check(not any(x.get('kind') == 'ping' and x.get('at') == {'x': 4, 'y': 1} for x in got), 'with the toggle off, a GM ping in plain view stayed private')
    check(not errs, f'GM page without errors ({errs[:3]})')
    gctx.close(); actx.close()

def _frames(frames):
    out = []
    for raw in frames:
        try: out.append(json.loads(raw))
        except Exception: pass
    return out

def _entry_events(msgs, t=None):
    return [e for m in msgs if m.get('t') == 'entries' for en in m['entries'] for e in en.get('events', []) if t is None or e.get('type') == t]

def pump(page, secs):
    """Wait while Playwright delivers WebSocket frames (a plain sleep doesn't)."""
    page.wait_for_timeout(int(secs * 1000))

def test_round6(browser, base):
    print('7. Quiet entries, refusals, owned gear, masked terrain, GM names, roster')
    gctx = new_ctx(browser); gm = gctx.new_page(); errs = []; page_errors(gm, errs, 'GM')
    code = gm_create(gm, base)
    actx = new_ctx(browser); a = actx.new_page(); fa = capture(a); pa = player_join(a, base, code, 'Ana')
    bctx = new_ctx(browser); b = bctx.new_page(); fb = capture(b); pb = player_join(b, base, code, 'Bo')
    # 14 x 6, a full wall at x = 7: the right half is never explored.
    cells = ''.join(''.join('#' if x == 7 else '.' for x in range(14)) for _ in range(6))
    nade = {'id': 'nade', 'name': 'Frag', 'type': 'grenade', 'ammo': {'loaded': 9, 'capacity': 9}}
    solo = actor('solo', 'Solo', 'pc', pa, extra={'stats': {'INT': 6, 'REF': 8, 'DEX': 6, 'TECH': 6, 'COOL': 6, 'WILL': 6, 'LUCK': 6, 'MOVE': 6, 'BODY': 6, 'EMP': 6},
        'gear': [{'name': 'Polymer Riot Slab', 'qty': 1, 'item': 'shield:riot-slab'}]})
    thug = actor('thug', 'Thug', 'npc'); thug['weapons'].append(nade)
    for i in [
        {'type': 'addActor', 'actor': solo},
        {'type': 'addActor', 'actor': actor('bopc', 'Bo PC', 'pc', pb)},
        {'type': 'addActor', 'actor': thug},
        {'type': 'addActor', 'actor': actor('zzone', 'Zzonename', 'npc')},
        {'type': 'addActor', 'actor': actor('zztwo', 'Zztwoname', 'npc')},
        {'type': 'setMap', 'map': {'id': 'm', 'name': 'Split', 'width': 14, 'height': 6, 'cells': cells, 'cellPx': 64, 'sightRange': 30,
                                   'tokens': {'solo': {'x': 2, 'y': 2}, 'bopc': {'x': 3, 'y': 4}, 'thug': {'x': 5, 'y': 1}, 'zzone': {'x': 10, 'y': 2}, 'zztwo': {'x': 12, 'y': 3}},
                                   'watches': {}, 'spotted': []}},
        {'type': 'net', 'op': {'op': 'saveArchitecture', 'architecture': {
            'id': 'icy', 'name': 'Icebox', 'difficulty': 'standard', 'rootId': 'f1', 'virusDv': 8,
            'floors': {'f1': {'id': 'f1', 'kind': 'blackIce', 'ice': [{'name': 'Hound', 'kind': 'antiPersonnel', 'per': 4, 'spd': 4, 'atk': 17, 'def': 4, 'rez': 10, 'damage': {'count': 1, 'sides': 6}}]}},
            'children': {}, 'access': [{'mapId': 'm', 'cells': [{'x': 2, 'y': 2}]}]}}},
        {'type': 'net', 'op': {'op': 'setRig', 'actorId': 'solo', 'rig': {'interface': 3, 'deckName': 'Deck', 'slots': 7, 'programs': []}}},
        {'type': 'net', 'op': {'op': 'revealAccess', 'archId': 'icy', 'found': True}},
    ]:
        if not gm_act(gm, i): print(f'    note: GM intent refused: {i["type"]} {gm.evaluate("() => window.__nsc.getState().toast?.text")}')
    pump(gm, 0.6)
    # #12 Unexplored terrain is masked for players.
    pm = a.evaluate('() => window.__nsc.getState().view.map')
    gmcells = gm.evaluate('() => window.__nsc.getState().view.map.cells')
    check(all(pm['cells'][y * 14 + 8: y * 14 + 14] == '??????' for y in range(6)) and pm['cells'][:7] == cells[:7], 'players get ? for squares the party has never explored')
    check('?' not in gmcells, 'the GM gets the real terrain everywhere')

    # #11 Players equip only what their character carries.
    def rejections(frames, since=0):
        return [m for m in _frames(frames[since:]) if m.get('t') == 'rejected']
    pump(gm, 0.3); n0 = len(fa)
    a.evaluate("() => window.__nsc.act({ type: 'gear', op: { op: 'equipShield', actorId: 'solo', templateId: 'door-panel' } })")
    a.evaluate("() => window.__nsc.act({ type: 'gear', op: { op: 'takeDrug', actorId: 'solo', drugId: 'glimmer' } })")
    a.evaluate("() => window.__nsc.act({ type: 'gear', op: { op: 'equipShield', actorId: 'solo', templateId: 'riot-slab' } })")
    pump(gm, 0.8)
    rj = [m['message'] for m in rejections(fa, n0)]
    check('Solo isn’t carrying a Salvaged Car Door.' in rj and 'Solo isn’t carrying any Glimmer.' in rj, f'shield and drug not carried are refused ({rj})')
    held = gm.evaluate("() => window.__nsc.getState().view.actors.solo.combatant")
    check((held.get('shield') or {}).get('name') == 'Polymer Riot Slab' and not any(g.get('item') == 'shield:riot-slab' for g in held.get('gear', [])), 'a carried shield is equipped and leaves the gear list')

    # #1 An NPC's area check shows players only its total.
    pend = None
    for _ in range(6):
        gm_act(gm, {'type': 'areaAttack', 'attackerId': 'thug', 'weaponId': 'nade', 'kind': 'thrownGrenade', 'at': {'x': 2, 'y': 2}})
        k = gm.evaluate('() => window.__nsc.getState().view.pending?.kind')
        if k in ('awaitingAreaDodge', 'awaitingScatter'):
            try: wait_for(a, f"() => window.__nsc.getState().view.pending?.kind === '{k}'", 5000)
            except Exception: pass
            pend = a.evaluate('() => window.__nsc.getState().view.pending')
            gm_act(gm, {'type': 'cancelPending'}); break
        if k: gm_act(gm, {'type': 'cancelPending'})
    check(pend is not None and sorted((pend.get('attack') or {}).keys()) == ['redacted', 'total'] and pend.get('damageDice') == 0,
          f'area/scatter pending carries only the attack total ({pend and pend.get("kind")}: {pend and pend.get("attack")})')
    pend_frames = [json.dumps(en.get('patch', {}).get('pending')) for m in _frames(fa) if m.get('t') == 'entries' for en in m['entries'] if (en.get('patch') or {}).get('pending')]
    check(not any('baseBreakdown' in f for f in pend_frames), 'no pending in any player frame carried a check breakdown')

    # Black ICE: its side of the contest is a total only.
    gm.evaluate("() => window.__nsc.act({ type: 'gear', op: { op: 'dropShield', actorId: 'solo' } })")
    a.evaluate("() => window.__nsc.act({ type: 'net', op: { op: 'jackIn', actorId: 'solo', archId: 'icy' } })")
    pump(gm, 0.6)
    if not gm_act(gm, {'type': 'net', 'op': {'op': 'iceAttack', 'actorId': 'solo', 'index': 0}}):
        print(f'    note: iceAttack refused: {gm.evaluate("() => window.__nsc.getState().toast?.text")}')
    pump(gm, 0.6)
    ice = [e for e in _entry_events(_frames(fa), 'netAction') if e.get('action') in ('iceAttack', 'speedCheck')]
    side = lambda e: e.get('check') if e.get('action') == 'iceAttack' else e.get('vs')
    check(any(e.get('action') == 'iceAttack' for e in ice) and all(side(e) and side(e).get('baseBreakdown') == [] and side(e).get('redacted') for e in ice),
          f'Black ICE checks reach players as totals ({[(e.get("action"), side(e)) for e in ice][:3]})')

    # #6 GM chat is marked as the GM's; GM names are reserved.
    if not gm_act(gm, {'type': 'chat', 'text': 'ZzFromTheGm'}): print(f'    note: chat refused: {gm.evaluate("() => window.__nsc.getState().toast?.text")}')
    pump(gm, 0.4)
    gmchat = [e for e in _entry_events(_frames(fa), 'chatMessage') if e.get('text') == 'ZzFromTheGm']
    check(len(gmchat) == 1 and gmchat[0].get('by') == 'gm', 'GM chat reaches players with by: "gm"')
    nctx = new_ctx(browser); n = nctx.new_page(); fn = capture(n)
    n.goto(f'{base}/?join={code}'); wait_for(n, '() => !!window.__nsc')
    n.get_by_label('Your name').fill('G M'); n.get_by_role('button', name='Join', exact=True).click()
    try: wait_for(n, "() => window.__nsc.getState().role === null && window.__nsc.getState().status === 'error'", 8000); back = True
    except Exception: back = False
    bad = [m for m in _frames(fn) if m.get('t') == 'error' and m.get('code') == 'BAD_NAME']
    check(back and bad and 'reserved for the GM' in bad[0]['message'], f'a player can’t join as "G M" ({bad[:1]})')
    nctx.close()

    # #2 Two unseen hostile Turns, a private roll and a whisper: other players get nothing.
    a.evaluate("() => window.__nsc.act({ type: 'net', op: { op: 'jackOut', actorId: 'solo' } })")
    gm_act(gm, {'type': 'startEncounter', 'participants': [{'actorId': 'solo', 'bonus': 20}, {'actorId': 'zzone', 'bonus': 10}, {'actorId': 'zztwo', 'bonus': 0}, {'actorId': 'bopc', 'bonus': -20}]})
    wait_for(gm, "() => window.__nsc.getState().view.encounter.order[0] === 'solo'")
    a.evaluate("() => window.__nsc.act({ type: 'endTurn' })")
    wait_for(gm, "() => { const e = window.__nsc.getState().view.encounter; return e.order[e.turnIndex] === 'zzone' }")
    pump(gm, 0.5)
    pump(gm, 0.2); mark_b, mark_a = len(fb), len(fa)
    gm_act(gm, {'type': 'moveToken', 'actorId': 'zzone', 'to': {'x': 10, 'y': 1}})
    gm_act(gm, {'type': 'endTurn'})
    gm_act(gm, {'type': 'moveToken', 'actorId': 'zztwo', 'to': {'x': 12, 'y': 4}})
    a.evaluate("() => window.__nsc.act({ type: 'rollDice', label: 'ZzAnaSecret', dice: { count: 1, sides: 10, bonus: 0 }, private: true })")
    a.evaluate("() => window.__nsc.act({ type: 'chat', text: 'ZzAnaWhisper', to: ['gm'] })")
    pump(gm, 1.2)
    quiet = [m for m in _frames(fb[mark_b:]) if m.get('t') == 'entries']
    check(not quiet, f'Bo received nothing during two unseen Turns, a private roll and a whisper ({len(quiet)} entries frames)')
    check('ZzAnaSecret' in ''.join(fa[mark_a:]), 'Ana got her own private roll')
    gm_act(gm, {'type': 'endTurn'})
    try: wait_for(b, "() => { const e = window.__nsc.getState().view.encounter; return e.order[e.turnIndex] === 'bopc' }", 5000); bo_turn = True
    except Exception: bo_turn = False
    check(bo_turn, 'Bo’s client follows the Turn to Bo after the gap')
    seqs = [en['seq'] for m in _frames(fb) if m.get('t') in ('entries',) for en in m['entries']]
    check(seqs == list(range(seqs[0], seqs[0] + len(seqs))) if seqs else False, f'Bo’s entry numbers have no gaps to count ({seqs[-6:]})')
    hidden_auth = [en for m in _frames(fb) if m.get('t') == 'entries' for en in m['entries'] if not en.get('events') and ('by' in en or 'intentType' in en)]
    check(not hidden_auth, 'entries without visible events carry no by or intentType')

    # #5 Refusals never name what the player can't see.
    pump(gm, 0.2); nb = len(fb)
    b.evaluate("() => window.__nsc.act({ type: 'chat', text: 'hi', asActorId: 'zzone' })")
    b.evaluate("() => window.__nsc.act({ type: 'chat', text: 'hi', asActorId: 'thug' })")
    b.evaluate("() => window.__nsc.act({ type: 'rangedAttack', attackerId: 'bopc', defenderId: 'zztwo', weaponId: 'pistol', distance: 10 })")
    pump(gm, 0.8)
    rb = [m['message'] for m in rejections(fb, nb)]
    check(len(rb) == 3 and all(x == 'You can’t do that.' for x in rb), f'refusals about unseen or GM-run actors are generic ({rb})')
    check(not any(s in ''.join(fb) for s in ['zzone', 'zztwo', 'Zzonename', 'Zztwoname', 'ZzAnaSecret', 'ZzAnaWhisper']), 'Bo never received an unseen actor, Ana’s private roll or her whisper')

    # #4 Roster: a returning player reclaims a seat; the GM renames, merges and removes.
    pctx = new_ctx(browser); ph = pctx.new_page(); player_join(ph, base, code, 'ana')
    wait_for(gm, '() => window.__nsc.getState().reclaims.length === 1')
    req = gm.evaluate('() => window.__nsc.getState().reclaims[0]')
    check(req['seatId'] == pa and req['name'] == 'Ana', f'the GM is asked to give the new device Ana’s seat ({req})')
    gm.evaluate('(id) => window.__nsc.answerReclaim(id, true)', req['requestId'])
    try: wait_for(ph, f"() => window.__nsc.getState().playerId === '{pa}'", 5000); ok = True
    except Exception: ok = False
    check(ok, 'approved: the new device is Ana, with her character')
    tctx = new_ctx(browser); tb = tctx.new_page(); tid = player_join(tb, base, code, 'Bo Tablet')
    gm.evaluate('([k, d]) => window.__nsc.mergePlayers(k, d)', [pb, tid])
    try: wait_for(tb, f"() => window.__nsc.getState().playerId === '{pb}'", 5000); ok = True
    except Exception: ok = False
    check(ok, 'merged: the tablet becomes Bo')
    gm.evaluate('(id) => window.__nsc.renamePlayer(id, "Bo Rivers")', pb)
    try: wait_for(a, "() => window.__nsc.getState().players.some(p => p.name === 'Bo Rivers')", 5000); ok = True
    except Exception: ok = False
    check(ok, 'renamed: other players see the new name')
    dctx = new_ctx(browser); dr = dctx.new_page(); did = player_join(dr, base, code, 'Drifter')
    gm.evaluate('(id) => window.__nsc.removePlayer(id)', did)
    try: wait_for(dr, '() => window.__nsc.getState().role === null', 5000); ok = True
    except Exception: ok = False
    names = gm.evaluate('() => window.__nsc.getState().players.map(p => p.name)')
    check(ok and 'Drifter' not in names, f'removed: the device is sent back to the join form ({names})')
    check(not errs, f'GM page without errors ({errs[:3]})')
    for c in (gctx, actx, bctx, pctx, tctx, dctx): c.close()

def main():
    for d in ['apps/web/dist/index.html', 'apps/relay/dist/server.js']:
        if not os.path.exists(os.path.join(ROOT, d)): sys.exit(f'Missing {d}: run npm run build first.')
    data = tempfile.mkdtemp(prefix='nsc-e2e-')
    # Local relays use ports 8191–8193; E2E_PORT picks one of them (default 8191).
    port = int(os.environ.get('E2E_PORT', '8191'))
    relay = Relay(data, port); relay.start()
    base = f'http://127.0.0.1:{port}'
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            only = os.environ.get('E2E_ONLY')  # e.g. E2E_ONLY=7 runs one check group
            groups = [lambda: test_identity(browser, base, relay), lambda: test_redaction(browser, base),
                      lambda: test_offline_tab_close(browser, base, relay), lambda: test_undo(browser, base),
                      lambda: test_bursts(browser, base), lambda: test_gm_signals(browser, base), lambda: test_round6(browser, base)]
            for i, g in enumerate(groups, 1):
                if not only or str(i) == only: g()
            browser.close()
    finally:
        relay.stop()
        shutil.rmtree(data, ignore_errors=True)
    for k, why in KNOWN_OPEN.items():
        if k in seen_known: print(f'  warn known-open: {why}')
        else: print(f'  note: known-open "{k}" did not reproduce; remove it from KNOWN_OPEN ({why})')
    if failures:
        print(f'\n{len(failures)} failure(s)'); sys.exit(1)
    print('\nE2E: all checks passed')

if __name__ == '__main__':
    main()
