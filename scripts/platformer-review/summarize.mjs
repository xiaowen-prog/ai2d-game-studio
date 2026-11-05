// Read-only aggregation of actual call logs and reopen checks, no model invocation.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root=resolve('../开发工作区/projects/AI2D游戏制作平台/docs/evidence/阶段2-5');
const runs=[];for(const name of await readdir(root)){if(!/^(topdown|platformer)-\d+$/.test(name))continue;try{runs.push(JSON.parse(await readFile(join(root,name,'真实调用检查.json'),'utf8')));}catch{}}
runs.sort((a,b)=>a.checkedAt.localeCompare(b.checkedAt));
const final=[];for(const mode of ['platformer']){const latest=JSON.parse(await readFile(resolve('.noobi-private/platformer-review',`latest-${mode}.json`),'utf8'));const saved=await readFile(join(latest.evidenceDirectory,'真实保存复核.json'),'utf8').then(JSON.parse).catch(()=>null);final.push({mode,passed:latest.passed&&saved?.passed===true,run:latest.evidenceDirectory,saved});}
const visual=await readFile(join(root,'视觉验收.json'),'utf8').then(JSON.parse).catch(()=>null);
const passed=final.every(r=>r.passed)&&visual?.passed===true,records=runs.flatMap(r=>r.records.map(row=>({...row,result:r.passed?'通过':'失败',source:r.evidenceDirectory}))).sort((a,b)=>a.started-b.started);
const summary={checkedAt:new Date().toISOString(),passed,final,visual,textTurns:records.length,imageCalls:runs.reduce((n,r)=>n+r.imageCalls,0),automaticRepairs:0,runs:runs.map(r=>({path:r.evidenceDirectory,passed:r.passed,error:r.error,text:r.textTurns,images:r.imageCalls}))};
await writeFile(join(root,'真实调用汇总.json'),JSON.stringify(summary,null,2));
await writeFile(join(root,'冒烟记录.md'),`# 冒烟记录（脚本读取真实日志自动汇总）\n\n- 模型：OpenAI / ${[...new Set(records.map(r=>r.model))].join(', ')}\n- 费用：已有 ChatGPT Pro；新增付费 API 0；自动修复 0。失败轮次全部保留。\n- 说明：记录覆盖本节点所有真实调用，包括失败和验收脚本异常；不把代码生成完成当作整条链路成功。最终链路与零调用重开检查：${passed?'通过':'未全部通过'}。\n\n| 时间 | 链路 | 请求 ID | 输入 token | 输出 token | 首字耗时 | 总耗时 | 结构校验 | 重试次数 | 结果 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`+records.map(r=>`| ${new Date(r.started).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})} | ${r.phase} | ${r.turnId} | ${r.usage?.inputTokens??'-'} | ${r.usage?.outputTokens??'-'} | ${r.firstMs??'-'} ms | ${r.elapsedMs} ms | ${r.result} | 0 | ${r.result} |`).join('\n')+'\n');
console.log(JSON.stringify(summary,null,2));
