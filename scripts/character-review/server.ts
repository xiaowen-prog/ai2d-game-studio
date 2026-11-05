// Local offline review only. Production does not import this fixture server.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreationWorkflowService, publicCreationError } from '../../src/main/creationWorkflowService.js';
import { CreationWorkflowStore, creationId } from '../../src/main/creationWorkflowStore.js';
import { CreationVersionStore } from '../../src/main/creationVersionStore.js';
import { StagedCreationGenerator } from '../../src/main/creationGenerator.js';
import { offlineCharacterGenerator } from './fixtures.js';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const data=resolve(process.env.RESTART_CHECK_DIR || join(repo,'.noobi-private/character-review-data'));
await mkdir(data,{recursive:true});
let activeId:string|null=await readFile(join(data,'active'),'utf8').catch(()=>null);
const store=new CreationWorkflowStore(join(data,'records'));
const versions=new CreationVersionStore(join(data,'artifacts'));
const generator=offlineCharacterGenerator(data,versions);
const service=new CreationWorkflowService({store,generator,validateSnapshot:async(id,snapshot)=>{await versions.root(id,snapshot);}});
// Only preview is used; it reads real saved snapshots through the production adapter.
const previews=new StagedCreationGenerator({versions,project:async(id:string)=>({id,root:data})} as never);
if(activeId)await service.recover(activeId);
const server=createServer(async(req,res)=>{
  const json=(value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
  try{
    if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host??''))return json({error:{message:'仅接受本机访问'}},403);
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json({error:{message:'不接受外部页面请求'}},403);
    const url=new URL(req.url!,'http://127.0.0.1');
    if(req.method==='GET'&&url.pathname==='/api/state')return json({workflow:activeId?await service.get(activeId):null,calls:generator.calls});
    if(req.method==='GET'&&url.pathname==='/api/record')return json(await service.get(url.searchParams.get('id')??''));
    if(req.method==='GET'&&url.pathname==='/api/preview'){
      const state=await service.get(url.searchParams.get('id')??'');if(!state)throw new Error('Missing record');
      return json({ok:true,value:await previews.preview(state,url.searchParams.get('version')??'')});
    }
    if(req.method==='POST'){
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>25_000)throw new Error('Request too long');}const input=JSON.parse(raw);
      if(url.pathname==='/api/new'){const state=await service.create(creationId(),input.idea);activeId=state.projectId;await writeFile(join(data,'active'),activeId);return json(state);}
      if(url.pathname==='/api/act'){try{return json({ok:true,value:await service.act(input)});}catch(error){return json({ok:false,error:publicCreationError(error)});}}
    }
    const files:Record<string,[string,string]>={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/app.css':['app.css','text/css']};
    const file=files[url.pathname];if(req.method!=='GET'||!file){res.writeHead(404);res.end();return;}
    const body=await readFile(join(repo,'.noobi-private/character-review',file[0]));
    res.writeHead(200,{'content-type':`${file[1]}; charset=utf-8`,'cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-src 'none'"});res.end(body);
  }catch(error){json({error:publicCreationError(error)},400);}
});
server.on('error',()=>{console.error('人物验收端口无法使用，未停止其他进程。');process.exit(1);});
server.listen(Number(process.env.CHARACTER_REVIEW_PORT??8795),'127.0.0.1',async()=>{
  const address=server.address();if(!address||typeof address==='string')return;
  await writeFile(join(data,'server.json'),JSON.stringify({pid:process.pid,port:address.port}));
  console.log(`人物候选离线验收：http://127.0.0.1:${address.port}/（真实模型 0 次）`);
});
process.on('SIGTERM',()=>{void service.stopAll().finally(()=>server.close(()=>process.exit(0)));});
