import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/index.js';
import {hashPassword} from '../server/security.js';
export const PASSWORD='Testing-Only-Good-Passphrase';
export const HASH=await hashPassword(PASSWORD);
export const actionId=()=>randomUUID();
export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function harness(t,options={}){
  const app=await createApp({tickMs:10,adminUser:'owner-test',adminPasswordHash:HASH,...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
  const streams=[];t.after(async()=>{streams.forEach(s=>s.close());await app.stop();});
  function client(){
    const c={cookie:'',csrf:'',me:null};
    c.req=async(route,msg,extra={})=>{
      const response=await fetch(base+route,{method:msg===undefined?'GET':'POST',headers:{...(msg===undefined?{}:{'Content-Type':'application/json','X-CR-Request':'1','X-CSRF-Token':c.csrf}),...(c.cookie?{Cookie:c.cookie}:{}),...(extra.headers||{})},body:msg===undefined?undefined:JSON.stringify(msg),...extra,...(extra.headers?{headers:{...(msg===undefined?{}:{'Content-Type':'application/json','X-CR-Request':'1','X-CSRF-Token':c.csrf}),...(c.cookie?{Cookie:c.cookie}:{}),...extra.headers}}:{})});
      const setCookie=response.headers.get('set-cookie');if(setCookie)c.cookie=setCookie.split(';')[0];
      const data=await response.json();if(data.me){c.me=data.me;c.csrf=data.me.csrf;}if(route==='/api/me'&&response.ok){c.me=data;c.csrf=data.csrf;}
      return {status:response.status,data,headers:response.headers};
    };
    c.post=(r,m={})=>c.req(r,{actionId:actionId(),...m});c.get=r=>c.req(r);
    c.register=async(name)=>{const out=await c.req('/api/auth/register',{username:name,name,password:PASSWORD});assert.equal(out.status,200,JSON.stringify(out.data));return c;};
    c.login=async(name,password=PASSWORD)=>{const out=await c.req('/api/auth/login',{username:name,password});assert.equal(out.status,200,JSON.stringify(out.data));return c;};
    c.state=async()=>{const out=await c.get('/api/state');assert.equal(out.status,200);return out.data;};
    c.action=async(type,extra={})=>{const s=await c.state();return c.post('/api/action',{type,handId:s.handId,turnSeq:s.turnSeq,...extra});};
    c.stream=async()=>{
      const controller=new AbortController();const response=await fetch(base+'/api/events',{headers:{Cookie:c.cookie},signal:controller.signal});assert.equal(response.status,200);
      const s={events:[],close:()=>controller.abort(),headers:response.headers};streams.push(s);
      (async()=>{let buffer='';const decoder=new TextDecoder();try{for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let i;while((i=buffer.indexOf('\n\n'))>=0){const packet=buffer.slice(0,i);buffer=buffer.slice(i+2);const event=packet.match(/^event: (.+)$/m),data=packet.match(/^data: (.+)$/m);if(event&&data)s.events.push({event:event[1],data:JSON.parse(data[1])});}}}catch{/* Aborted during cleanup. */}})();
      s.wait=async(event,predicate=()=>true)=>{for(let i=0;i<350;i++){const found=s.events.findLast(x=>x.event===event&&predicate(x.data));if(found)return found.data;await pause(10);}throw new Error('SSE attendu non reçu');};return s;
    };
    return c;
  }
  return {app,base,client};
}
