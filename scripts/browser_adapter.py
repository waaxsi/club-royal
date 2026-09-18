"""Local-only visual test adapter for environments which forbid browser navigation.

Does NOT alter browser policies. Renders the actual local files in about:blank;
HTTP requests and real SSE streams are relayed to a loopback test server by httpx.
This validates UI and live server interactions but is NOT a native-browser
cookie/origin test. Use test-ui.py without --adapted for normal end-to-end testing.
Requires optional testing tools: playwright and httpx (not runtime dependencies).
"""
import asyncio
import re
from pathlib import Path
from urllib.parse import urlparse
import httpx

ROOT = Path(__file__).resolve().parents[1]

class LocalBrowserAdapter:
    def __init__(self, page, base):
        if urlparse(base).hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise ValueError('Adapter restricted to a loopback test server')
        self.page, self.base, self.tasks = page, base, {}
        self.client = httpx.AsyncClient(base_url=base, trust_env=False,
            timeout=httpx.Timeout(20.0, read=None))

    async def install(self):
        async def fetch_bridge(url, method, headers, body):
            if not isinstance(url, str) or not url.startswith('/api/'):
                raise ValueError('Only local API routes are allowed')
            response = await self.client.request(method, url, headers=headers,
                content=body.encode() if body is not None else None)
            return {'status': response.status_code, 'data': response.json()}

        async def sse_open(key):
            async def reader():
                try:
                    async with self.client.stream('GET', '/api/events') as response:
                        if response.status_code != 200:
                            await self.deliver(key, 'error', '')
                            return
                        await self.deliver(key, 'open', '')
                        event, data = '', ''
                        async for line in response.aiter_lines():
                            if line.startswith('event: '): event = line[7:]
                            elif line.startswith('data: '): data = line[6:]
                            elif not line and event:
                                await self.deliver(key, event, data)
                                event, data = '', ''
                except asyncio.CancelledError:
                    pass
                except Exception:
                    if not self.page.is_closed():
                        await self.deliver(key, 'error', '')
            self.tasks[key] = asyncio.create_task(reader())

        async def sse_close(key):
            task = self.tasks.pop(key, None)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

        await self.page.expose_function('__local_fetch', fetch_bridge)
        await self.page.expose_function('__local_sse_open', sse_open)
        await self.page.expose_function('__local_sse_close', sse_close)
        html = (ROOT/'public/index.html').read_text()
        html = re.sub(r'<script\b[^>]*>.*?</script>', '', html, flags=re.S)
        html = re.sub(r'<link\b[^>]*>', '', html)
        await self.page.set_content(html)
        await self.page.add_style_tag(content=(ROOT/'public/styles.css').read_text())
        await self.page.evaluate('''() => {
            window.__streams=new Map();
            window.fetch=async (url,args={}) => {
                const result=await window.__local_fetch(url,args.method||'GET',args.headers||{},args.body??null);
                return {status:result.status,ok:result.status>=200&&result.status<300,json:async()=>result.data};
            };
            window.EventSource=class {
                constructor(url){this.key=String(Date.now())+'-'+Math.random();this.listeners=new Map();window.__streams.set(this.key,this);window.__local_sse_open(this.key);}
                addEventListener(name,fn){this.listeners.set(name,fn);}
                close(){window.__local_sse_close(this.key);window.__streams.delete(this.key);}
            };
            window.__deliver=(key,name,data)=>{const s=window.__streams.get(key);if(!s)return;if(name==='open')s.onopen?.();else if(name==='error')s.onerror?.();else s.listeners.get(name)?.({data});};
        }''')
        source = []
        for name in ('cards-ui', 'effects', 'art', 'app'):
            text = (ROOT/f'public/{name}.js').read_text()
            text = re.sub(r'^import[^\n]*\n', '', text, flags=re.M)
            text = re.sub(r'\bexport\s+(?=(const|let|function|class)\b)', '', text)
            source.append(text)
        await self.page.add_script_tag(type='module', content='\n'.join(source))

    async def deliver(self, key, name, data):
        if not self.page.is_closed():
            await self.page.evaluate('(args)=>window.__deliver(...args)', [key, name, data])

    async def close(self):
        for task in list(self.tasks.values()): task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        await self.client.aclose()
