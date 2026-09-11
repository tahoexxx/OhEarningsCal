import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const clean = s => load(String(s ?? '')).text().replace(/\s+/g,' ').trim();
export const hash = s => createHash('sha256').update(s).digest('hex');
export const day = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
export const shift = (d,n) => new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function clock(s) {
 const m=clean(s).replaceAll('.','').match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
 if(!m) return null;
 let h=Number(m[1]);const min=Number(m[2]||0);
 if(m[3]) h=h%12+(m[3].toLowerCase()==='pm'?12:0);
 return h<24&&min<60?`${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`:null;
}
export function zonedUtc(date,time,zone) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)) throw Error('Invalid date/time');
 const wall=Date.parse(`${date}T${time}:00Z`);
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 let utc=wall;
 for(let i=0;i<3;i++) {
  const p=Object.fromEntries(fmt.formatToParts(new Date(utc)).map(x=>[x.type,x.value]));
  utc+=wall-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
 }
 const p=Object.fromEntries(fmt.formatToParts(new Date(utc)).map(x=>[x.type,x.value]));
 if(`${p.year}-${p.month}-${p.day}`!==date||`${p.hour}:${p.minute}`!==time) throw Error('Nonexistent local time');
 return new Date(utc).toISOString();
}
export function event({id,title,date,time=null,zone='America/New_York',category='macro',url,source,detail='',tickers=[],status='confirmed',...rest}) {
 const e={...rest,id,title,category,date,time,timezone:zone,start:time?zonedUtc(date,time,zone):null,url,source,detail,tickers,status};
 if(!id||!title||!/^https:\/\//.test(url)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date).toISOString().slice(0,10)!==date) throw Error('Invalid event');
 return e;
}
export function mergeEvents(previous,incoming,now) {
 // Updates use stable IDs; retain history and events that disappear from rolling feeds.
 const map=new Map(previous.map(e=>[e.id,e]));
 for(const e of incoming) {
  const old=map.get(e.id);
  const changed=old&&(old.start!==e.start||old.date!==e.date||old.status!==e.status);
  map.set(e.id,{...e,first_seen:old?.first_seen||now,last_verified:now,
   revision:(old?.revision||0)+(changed?1:0),
   ...(changed?{previous_start:old.start||old.date}:{previous_start:old?.previous_start})});
 }
 return [...map.values()].filter(e=>e.date>=shift(now.slice(0,10),-370)).sort((a,b)=>(a.start||a.date).localeCompare(b.start||b.date));
}
