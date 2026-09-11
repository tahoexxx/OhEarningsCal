import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchWithRetry } from '../lib/http.js';
import { ROOT } from '../lib/paths.js';
import { MONTHS,shift,mergeEvents,hash } from '../calendar/core.js';
import { FED,BEA,APPLE,parseFed,fedAnnualEvents,parseFedMonth,parseBea,parseApple } from '../calendar/official.js';
import { NASDAQ,BLS_ANCHORS,calibrate,parseNasdaq } from '../calendar/nasdaq.js';
import { publishCalendar } from '../calendar/publish.js';

const now=new Date().toISOString(),today=now.slice(0,10),year=+today.slice(0,4);
const cache=resolve(ROOT,'data/market-calendar');await mkdir(cache,{recursive:true});
const file=resolve(cache,'state.json');
let previous={events:[],sources:{},candidates:[]};
try {previous=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')console.warn('[calendar] invalid cache, rebuilding');}
const state={events:previous.events||[],sources:{...previous.sources},candidates:previous.candidates||[]};
const get=async url=>{
 const r=await fetchWithRetry(url,{headers:{accept:'application/json, text/plain, */*',origin:'https://www.nasdaq.com',referer:'https://www.nasdaq.com/'}},{timeoutMs:12000,retries:1});
 // Body timeout is independent: fetchWithRetry's timer covers only response headers.
 let timer;try{return await Promise.race([r.text(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Response body timeout')),12000);})]);}finally{clearTimeout(timer);}
};
const failure=(id,e)=>{
 state.sources[id]={...state.sources[id],status:'error',last_attempt:now,error:String(e.message).slice(0,300)};
 console.warn(`[calendar] ${id}: ${e.message}; retained prior events`);
};
const success=(id,events,extra={})=>{
 state.events=mergeEvents(state.events,events,now);
 state.sources[id]={status:'ok',last_attempt:now,last_success:now,count:events.length,...extra};
 console.log(`[calendar] ${id}: ${events.length} events`);
};
const meetings=[],fedPrecise=[];
try {
 const html=await get(FED);meetings.push(...parseFed(html,year));
 try{meetings.push(...parseFed(html,year+1));}catch{/* Next annual calendar may not be published yet. */}
 let events=fedAnnualEvents(meetings).filter(e=>e.date>=shift(today,-31));
 // Preserve previously verified exact time if an annual date still agrees.
 events=events.map(e=>{const old=state.events.find(o=>o.id===e.id&&o.date===e.date&&o.start);return old?{...e,start:old.start,time:old.time,url:old.url}:e;});
 const monthErrors=[];
 for(let offset=-1;offset<=3;offset++) {
  const d=new Date(Date.UTC(year,+today.slice(5,7)-1+offset,1));
  const y=d.getUTCFullYear(),m=d.getUTCMonth()+1;
  try{fedPrecise.push(...parseFedMonth(await get(`https://www.federalreserve.gov/newsevents/${y}-${MONTHS[m-1].toLowerCase()}.htm`),y,m,meetings));}
  catch(e){monthErrors.push(`${y}-${m}: ${e.message}`);}
 }
 success('fed',[...events,...fedPrecise],{url:FED,coverage_end:meetings.at(-1)?.end,month_errors:monthErrors});
 if(monthErrors.length)state.sources.fed.status='partial';
}catch(e){failure('fed',e);}
await Promise.all([
 (async()=>{try {success('bea',parseBea(await get(BEA)),{url:BEA});}catch(e){failure('bea',e);}})(),
 (async()=>{try {
  const xml=await get(APPLE),parsed=parseApple(xml,now);
  // Persist ambiguous announcements across runs for human/LLM review, without falsely confirming them.
  const candidates=new Map(state.candidates.map(c=>[c.id,c]));
  parsed.candidates.forEach(c=>candidates.set(c.id,{...c,content_hash:hash(c.evidence)}));
  state.candidates=[...candidates.values()].filter(c=>c.published>=shift(today,-180));
  success('apple',parsed.events,{url:APPLE,review_count:state.candidates.length});
 }catch(e){failure('apple',e);}})(),
]);
try {
 const days=[],failed=[];
 const queries=Array.from({length:40},(_,i)=>shift(today,i-7));
 let cursor=0;
 await Promise.all(Array.from({length:3},async()=>{
  while(cursor<queries.length){const query=queries[cursor++];
   try{const payload=JSON.parse(await get(`${NASDAQ}?date=${query}`));
    if(payload?.data===null&&payload?.status?.rCode===200){days.push({query,rows:[]});continue;}
    if(!payload?.data||!('rows'in payload.data)||!(Array.isArray(payload.data.rows)||payload.data.rows===null))throw Error('Invalid Nasdaq calendar schema');
    days.push({query,rows:payload.data.rows||[]});
   }catch(e){failed.push({query,error:String(e.message).slice(0,160)});}
  }
 }));
 const anchors=[...BLS_ANCHORS,...fedPrecise.filter(e=>e.id.startsWith('fed-decision')&&e.time).map(e=>({name:'FOMC Statement',date:e.date,time:e.time,zone:e.timezone})),...fedPrecise.filter(e=>e.id.startsWith('fed-press')&&e.time).map(e=>({name:'FOMC Press Conference',date:e.date,time:e.time,zone:e.timezone}))];
 const calibration=calibrate(days,anchors),events=parseNasdaq(days,calibration);
 if(!events.length)throw Error('No selected releases, preserving cache');
 success('nasdaq',events,{url:NASDAQ,calibration,failed_dates:failed,requested_through:queries.at(-1),coverage_end:events.map(e=>e.date).sort().at(-1),horizon_note:'Nasdaq 前瞻约 2–4 周，未列出不代表无事件'});
 if(failed.length)state.sources.nasdaq.status='partial';
}catch(e){failure('nasdaq',e);}
// A reviewed public override can add/correct events; its verification timestamp is never refreshed by build.
try {
 const {overrides,dismissals=[]}=JSON.parse(await readFile(resolve(ROOT,'src/calendar/reviewed-events.json'),'utf8'));
 state.candidates=state.candidates.filter(c=>!dismissals.some(d=>d.id===c.id&&d.content_hash===c.content_hash));
 for(const e of overrides){
  const candidate=state.candidates.find(c=>c.url===e.url);
  if(!e.id||!e.last_verified||!e.evidence||!e.reviewed_by||!/^https:\/\/(developer\.)?apple\.com\//.test(e.url))throw Error('Invalid reviewed override');
  if(candidate&&candidate.content_hash!==e.content_hash){failure('reviewed',Error('Reviewed source changed; re-review needed'));continue;}
  if(!state.events.some(o=>o.id===e.id&&o.last_verified>e.last_verified))state.events=mergeEvents(state.events,[e],e.last_verified);
 }
}catch(e){failure('reviewed',e);}
state.events=state.events.filter(e=>e.date>=shift(today,-370));
await writeFile(file+'.tmp',JSON.stringify(state,null,2)+'\n');await rename(file+'.tmp',file);
await publishCalendar(state,now);
console.log(`[calendar] published ${state.events.length} events; ${state.candidates.length} announcements await review`);
