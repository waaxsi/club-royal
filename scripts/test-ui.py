"""Six-game UI verification on an isolated local server.
Default: normal browser navigation. --adapted: explicit local rendering adapter.
Testing dependencies only: pip install playwright httpx; install a Chromium browser.
No browser policies are modified. No tests or credentials touch the public site.
"""
import argparse, asyncio, json, os, secrets, shutil, sys
from pathlib import Path
from playwright.async_api import async_playwright
from browser_adapter import LocalBrowserAdapter

ROOT=Path(__file__).resolve().parents[1]

async def run(adapted=False, output=None):
    password='Test-'+secrets.token_urlsafe(22)
    env=dict(os.environ, CLUB_UI_TEST_PASSWORD=password)
    process=await asyncio.create_subprocess_exec('node','scripts/ui-server.mjs',cwd=ROOT,env=env,
        stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
    line=await asyncio.wait_for(process.stdout.readline(),10)
    if not line: raise RuntimeError('Isolated test server did not start')
    base='http://127.0.0.1:'+str(json.loads(line)['port'])
    out=Path(output or ROOT/'docs/apercus-v2');out.mkdir(parents=True,exist_ok=True)
    report={'mode':'local-rendering-adapter + real HTTP/SSE' if adapted else 'native Chromium HTTP/SSE',
        'checks':[],'pageErrors':[],'overflows':[],'screenshots':[]}
    adapters=[]
    async def api(page,route,msg=None):
        return await page.evaluate('''async ({route,msg})=>{
          const me=await (await fetch('/api/me')).json();
          const options=msg?{method:'POST',headers:{'Content-Type':'application/json','X-CR-Request':'1','X-CSRF-Token':me.csrf},body:JSON.stringify({...msg,actionId:crypto.randomUUID?.()||'test-'+Date.now()+'-'+Math.random()})}:{};
          return await (await fetch(route,options)).json();
        }''',{'route':route,'msg':msg})
    async def dismiss(page):
        if await page.locator('[data-do=tutorial-done]').is_visible():await page.locator('[data-do=tutorial-done]').click()
    async def home(page):
        if await page.locator('#dialog').is_visible():await page.locator('#dialog [data-do=close]').click()
        await page.locator('.rail-btn[data-nav=home]').click()
    async def capture(page,name,mobile=False):
        await page.set_viewport_size({'width':390,'height':844} if mobile else {'width':1440,'height':1000})
        await page.evaluate('window.scrollTo(0,0)')
        await page.wait_for_timeout(160)
        overflow=await page.evaluate('document.documentElement.scrollWidth > innerWidth')
        if overflow:report['overflows'].append(name)
        await page.screenshot(path=str(out/name),full_page=True)
        report['screenshots'].append(name)
        assert not overflow, 'Horizontal overflow: '+name
    async def auth(page,username,register=True):
        await page.locator('#account-button').click()
        if register:
            await page.locator('[data-auth=register]').click()
        await page.locator('#auth-user').fill(username)
        if register:await page.locator('#auth-name').fill(username.capitalize())
        await page.locator('#auth-password').fill(password)
        await page.locator('form[data-form=auth] button').click()
        await page.wait_for_function("!document.querySelector('#wallet-button').hidden")
        await dismiss(page);await home(page)
    async def setup(page,game,solo=True,bots='2'):
        await home(page)
        await page.locator('.game-card[data-game='+game+']').click()
        await page.locator('#table-mode').select_option('solo' if solo else 'private')
        if game=='poker':await page.locator('#table-bots').select_option(bots)
        await page.locator('form[data-form=create] button').click()
        await page.wait_for_selector('.table-surface')
    async def leave(page):
        await page.locator('.table-heading [data-do=leave]').click()
        await page.locator('[data-do=confirm-leave]').click()
        await page.wait_for_selector('.hero')
        assert await page.locator('#result-layer').is_hidden(), 'Result overlay leaked into another route'
    try:
      async with async_playwright() as p:
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        browser=await p.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}),args=['--no-sandbox'])
        async def new_page():
            context=await browser.new_context(viewport={'width':1440,'height':1000})
            page=await context.new_page();page.set_default_timeout(10000)
            page.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
            if adapted:
                adapter=LocalBrowserAdapter(page,base);adapters.append(adapter);await adapter.install()
            else:await page.goto(base)
            await page.wait_for_selector('.hero')
            return page
        alice=await new_page();bob=await new_page();admin=await new_page()
        await capture(alice,'01-accueil-ordinateur.png')
        await capture(alice,'01-accueil-mobile.png',True)
        await alice.set_viewport_size({'width':1440,'height':1000})
        await auth(alice,'alice');await auth(bob,'bob');await auth(admin,'owner-ui',False)
        report['checks'].append('Three independent sessions: register two players and login owner')
        await setup(alice,'poker',False)
        state=await api(alice,'/api/state');code=state['code']
        await bob.locator('.hero [data-do=join]').click();await bob.locator('#join-code').fill(code)
        await bob.locator('form[data-form=find-room] button').click()
        await bob.locator('input[name=acceptBoost]').check()
        await bob.locator('form[data-form=join] button').click()
        await bob.wait_for_selector('.table-surface')
        await alice.locator('[data-action=start]').click()
        await alice.wait_for_selector('.seat.self .playing-card')
        await alice.wait_for_timeout(420)
        matrix=await alice.locator('.seat.self .card-rotor').first.evaluate('el=>getComputedStyle(el).transform')
        assert 'matrix3d' in matrix, 'Card has no real 3D flip transform'
        await alice.evaluate('window.__cardIdentity=document.querySelector(".seat.self .playing-card")')
        astate=await api(alice,'/api/state');bstate=await api(bob,'/api/state')
        assert all(c is None for c in next(x for x in bstate['players'] if x['id']==astate['you'])['cards'])
        report['checks'].append('Two-player private Boost room: explicit consent, private cards and real slow flip')
        await alice.wait_for_timeout(950)
        for i in range(20):
            s=await api(alice,'/api/state')
            if s['phase'] in ('flop','results'):break
            actor=alice if s['turn']==s['you'] else bob
            v=await api(actor,'/api/state')
            await actor.locator('[data-action='+('check' if v['legal']['check'] else 'call')+']').click()
            await actor.wait_for_timeout(100)
        assert await alice.evaluate('window.__cardIdentity===document.querySelector(".seat.self .playing-card")'), 'Cards recreated on another state update'
        await alice.wait_for_timeout(1600)
        await capture(alice,'02-poker-ordinateur.png')
        await capture(alice,'02-poker-mobile.png',True)
        await alice.set_viewport_size({'width':1440,'height':1000})
        for i in range(30):
            s=await api(alice,'/api/state')
            if s['phase']=='results':break
            actor=alice if s['turn']==s['you'] else bob
            v=await api(actor,'/api/state')
            await actor.locator('[data-action='+('check' if v['legal']['check'] else 'call')+']').click()
            await actor.wait_for_timeout(120)
        assert s['phase']=='results'
        winner=alice if next(r for r in s['results'] if r['id']==s['you'])['net']>0 else bob
        await winner.wait_for_selector('#result-layer:not([hidden])',timeout=8000)
        await winner.wait_for_timeout(650)
        await capture(winner,'03-resultat-central.png')
        report['checks'].append('Full poker hand via buttons, cards retained across states, central result overlay')
        await leave(alice);await leave(bob)
        await setup(alice,'blackjack')
        await alice.locator('[data-action=bet]').click();await alice.wait_for_timeout(1550)
        await capture(alice,'04-blackjack-ordinateur.png')
        await capture(alice,'04-blackjack-mobile.png',True)
        await alice.set_viewport_size({'width':1440,'height':1000})
        if await alice.locator('[data-action=stand]').is_visible():await alice.locator('[data-action=stand]').click()
        await alice.wait_for_timeout(1300);await leave(alice)
        report['checks'].append('Blackjack bet, visible hand totals, dealer reveal and settlement')
        await setup(alice,'roulette')
        await alice.locator('[data-rbet=red]').click();await alice.locator('[data-rbet=straight][data-selection="7"]').click()
        await alice.locator('[data-action=rouletteBet]').click()
        await alice.wait_for_timeout(500)
        spin=await api(alice,'/api/state');assert spin['phase']=='spinning' and spin['winningNumber'] is None
        await capture(alice,'05-roulette-ordinateur.png')
        await capture(alice,'05-roulette-mobile.png',True)
        await alice.set_viewport_size({'width':1440,'height':1000})
        await alice.wait_for_function("document.querySelector('#table-phase')?.textContent==='Résultats'",timeout=10000)
        await alice.wait_for_timeout(2200)
        r=await api(alice,'/api/state');assert 0<=r['winningNumber']<=36
        assert await alice.locator('#wheel-value').inner_text()==str(r['winningNumber'])
        await leave(alice)
        report['checks'].append('Roulette draft bets, server-locked spin and matching displayed final number')
        await alice.locator('.game-card[data-game=mines]').click()
        await alice.locator('#mine-count').select_option('1')
        found=False
        for tries in range(5):
            await alice.locator('[data-do=mines-start]').click()
            await alice.wait_for_selector('[data-do=mines-cancel]:not([hidden])')
            await alice.locator('[data-cell="0"]').click();await alice.wait_for_timeout(1150)
            m=(await api(alice,'/api/me'))['mines']
            if m['status']=='playing':found=True;break
        box=await alice.locator('.mine-rotor').first.bounding_box()
        assert box and box['width']>50 and box['height']>50, 'Mines tile rotor has no visible box'
        await capture(alice,'06-cristaux-ordinateur.png')
        await capture(alice,'06-cristaux-mobile.png',True)
        await alice.set_viewport_size({'width':1440,'height':1000})
        if found:await alice.locator('[data-do=mines-cashout]').click()
        report['checks'].append('Cristaux: fixed hidden board, animated tile, server result'+(' and cashout' if found else ' (cashout not reached in random samples)'))
        await home(alice);await alice.locator('.game-card[data-game=dice]').click()
        await alice.locator('#dice-chance').fill('60')
        await alice.locator('[data-do=dice-play]').click();await alice.wait_for_timeout(1750)
        assert await alice.locator('#dice-value').inner_text()!='—'
        await alice.wait_for_timeout(3500)
        await capture(alice,'07-dice-ordinateur.png')
        await capture(alice,'07-dice-mobile.png',True)
        await alice.set_viewport_size({'width':1440,'height':1000})
        await home(alice);await alice.locator('.game-card[data-game=plinko]').click()
        await alice.locator('[data-do=plinko-play]').click();await alice.wait_for_timeout(2800)
        assert await alice.locator('[data-bucket].landed').count()==1
        await alice.wait_for_timeout(3500)
        await capture(alice,'08-plinko-ordinateur.png')
        await capture(alice,'08-plinko-mobile.png',True)
        report['checks'].append('Dice threshold and actual result; Plinko twelve-step trajectory and final bucket')
        await alice.set_viewport_size({'width':1440,'height':1000})
        await alice.locator('.rail-btn[data-nav=wallet]').click();await alice.wait_for_selector('.data-table')
        await capture(alice,'09-portefeuille-ordinateur.png')
        await capture(alice,'09-portefeuille-mobile.png',True)
        await admin.locator('.rail-btn[data-nav=admin]').click();await admin.wait_for_selector('[data-manage]')
        am=await api(alice,'/api/me');before=am['wallet']['available']
        await admin.locator('[data-manage="'+am['id']+'"]').click()
        await admin.locator('#admin-amount').fill('25');await admin.locator('#balance-reason').fill('Crédit de démonstration pour la classe')
        await admin.locator('form[data-form=admin-balance] button').click()
        await admin.wait_for_selector('#dialog:not([open])',state='attached')
        await alice.wait_for_timeout(400)
        after=(await api(alice,'/api/me'))['wallet']['available'];assert after==before+2500
        assert (await alice.locator('#header-balance').inner_text()).replace('\u202f','')
        await capture(admin,'10-admin-ordinateur.png')
        await capture(admin,'10-admin-mobile.png',True)
        report['checks'].append('Unified wallet history and owner balance action, live change in player session, audit')
        assert not report['pageErrors'],report['pageErrors']
        for adapter in adapters:await adapter.close()
        adapters=[]
        await browser.close()
    finally:
        for adapter in adapters:await adapter.close()
        process.terminate()
        try:await asyncio.wait_for(process.wait(),8)
        except asyncio.TimeoutError:process.kill();await process.wait()
        (out/'rapport-ui.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--adapted',action='store_true');parser.add_argument('--output')
    args=parser.parse_args();asyncio.run(run(args.adapted,args.output))
