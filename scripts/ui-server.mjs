/** Isolated browser-test fixture. Never used by npm start or exposed as an API. */
import {createApp} from '../server/index.js';
import {hashPassword} from '../server/security.js';
if(!process.env.CLUB_UI_TEST_PASSWORD)throw new Error('Launch through scripts/test-ui.py.');
const app=await createApp({adminUser:'owner-ui',adminPasswordHash:await hashPassword(process.env.CLUB_UI_TEST_PASSWORD),tickMs:25,botMs:400});
app.server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:app.server.address().port})));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,async()=>{await app.stop();process.exit();});
