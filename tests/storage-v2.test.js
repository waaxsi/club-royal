import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SnapshotStore,StorageError} from '../server/storage.js';
import {emptyState,CasinoHub} from '../server/hub.js';
import {HASH} from './v2-helpers.js';

/** Tests the documented libSQL /v2/pipeline wire shape against real local SQLite.
 * This is a protocol simulator, NOT a test against the hosted Turso service. */
async function libsqlFixture(t){
  const db=new DatabaseSync(':memory:');let dropNextWrite=false,fail=false,requests=0;
  const server=http.createServer(async(req,res)=>{
    requests++;assert.equal(req.url,'/v2/pipeline');assert.equal(req.headers.authorization,'Bearer fixture-token-only');let body='';for await(const part of req)body+=part;
    if(fail){res.writeHead(503);res.end('{}');return;}
    const packet=JSON.parse(body),execute=packet.requests[0];assert.equal(execute.type,'execute');assert.equal(packet.requests[1].type,'close');assert.equal(execute.stmt.want_rows,true);
    const{sql,args}=execute.stmt;const values=args.map(v=>v.type==='integer'?Number(v.value):v.type==='null'?null:v.value);
    try{const stmt=db.prepare(sql);let rows=[],affected=0;if(/^\s*SELECT/i.test(sql)||/\bRETURNING\b/i.test(sql))rows=stmt.all(...values);else affected=Number(stmt.run(...values).changes);
      if(dropNextWrite&&/^UPDATE cr_snapshot SET payload/.test(sql)){dropNextWrite=false;req.socket.destroy();return;}
      const cols=rows.length?Object.keys(rows[0]).map(name=>({name})):[];
      const result={cols,rows:rows.map(row=>cols.map(({name})=>row[name]===null?{type:'null'}:typeof row[name]==='number'?{type:'integer',value:String(row[name])}:{type:'text',value:row[name]})),affected_row_count:affected};
      res.setHeader('content-type','application/json');res.end(JSON.stringify({results:[{type:'ok',response:{type:'execute',result}},{type:'ok',response:{type:'close'}}]}));
    }catch{res.setHeader('content-type','application/json');res.end(JSON.stringify({results:[{type:'error',error:{message:'SQL fixture failure'}}]}));}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});db.close();});
  const options={remoteUrl:`http://127.0.0.1:${server.address().port}`,remoteToken:'fixture-token-only',allowHttp:true};return{options,drop(){dropNextWrite=true;},fail(){fail=true;},get requests(){return requests;}};
}
test('Stockage local : sauvegarde, réouverture et verrou de remplacement d’instance',async t=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'club-storage-'));const filename=path.join(dir,'state.sqlite');const a=new SnapshotStore({filename}),b=new SnapshotStore({filename});t.after(()=>{a.close();b.close();try{rmSync(dir,{recursive:true,force:true});}catch{}});const data=await a.open(emptyState());data.settings.banner='Persistant';await a.save(data);const reopened=await b.open(emptyState());assert.equal(reopened.settings.banner,'Persistant');await assert.rejects(a.save(data),StorageError);assert.equal(a.lost,true);assert.equal(await b.checkOwner(),true);
});
test('Stockage distant : protocole HTTP, paramètres typés, SQL CAS et contenu persistant',async t=>{
  const fixture=await libsqlFixture(t),a=new SnapshotStore(fixture.options),data=await a.open(emptyState());data.settings.banner='Bonjour la classe';await a.save(data);const b=new SnapshotStore(fixture.options),again=await b.open(emptyState());assert.equal(again.settings.banner,'Bonjour la classe');assert.equal(a.mode,'turso');assert.equal(await a.checkOwner(),false);assert.ok(fixture.requests>=7);
});
test('Stockage distant : réponse perdue après COMMIT détectée, aucun second débit',async t=>{
  const fixture=await libsqlFixture(t),a=new SnapshotStore(fixture.options),data=await a.open(emptyState());data.settings.banner='Committed once';fixture.drop();await a.save(data);assert.equal(a.lost,false);const row=(await a.query('SELECT revision,payload FROM cr_snapshot WHERE id=1')).rows[0];assert.equal(row.revision,2);assert.equal(JSON.parse(row.payload).settings.banner,'Committed once');
});
test('Stockage distant : panne ambiguë stoppe toute écriture, plutôt que réessayer en aveugle',async t=>{
  const fixture=await libsqlFixture(t),a=new SnapshotStore(fixture.options),data=await a.open(emptyState());fixture.fail();await assert.rejects(a.save(data),StorageError);assert.equal(a.lost,true);await assert.rejects(a.save(data),StorageError);
});
test('Stockage : HTTPS, jeton requis, schéma incompatible et capacité protégés',async t=>{
  assert.throws(()=>new SnapshotStore({remoteUrl:'http://invalid.test',remoteToken:'abc'}),/HTTPS/);assert.throws(()=>new SnapshotStore({remoteUrl:'https://user:password@invalid.test',remoteToken:'abc'}));assert.throws(()=>new SnapshotStore({remoteUrl:'https://invalid.test'}),/TURSO_AUTH_TOKEN/);
  const a=new SnapshotStore();t.after(()=>a.close());const d=await a.open(emptyState());d.settings.banner='x'.repeat(33*1024*1024);await assert.rejects(a.save(d),/archivé/);assert.equal(a.revision,1);
});
test('Administration : aucun joueur préexistant ne peut devenir le propriétaire par collision de pseudo',async t=>{
  const a=new SnapshotStore();t.after(()=>a.close());const h=await new CasinoHub(a).init();await h.run(()=>h.register({username:'future-owner',name:'Un joueur'},HASH));await assert.rejects(new CasinoHub(a,{adminUser:'future-owner',adminPasswordHash:HASH}).init(),/appartient déjà/);
});
