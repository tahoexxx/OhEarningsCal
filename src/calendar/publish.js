import { createEvents } from 'ics';
import { writeFile,mkdir } from 'node:fs/promises';
import { ICS_DIR } from '../lib/paths.js';
import { DATA_DIR } from '../lib/paths.js';

export function calendarIcs(events,slug,now) {
 const rows=events.map(e=>({
  uid:`${e.id}@oh-earnings-cal`,title:e.title,
  start:e.start?e.start.slice(0,16).match(/\d+/g).map(Number):e.date.split('-').map(Number),
  startInputType:'utc',startOutputType:'utc',
  ...(e.end_date&&!e.start?{end:e.end_date.split('-').map(Number)}:{}),
  status:e.status==='cancelled'?'CANCELLED':e.status==='confirmed'?'CONFIRMED':'TENTATIVE',
  sequence:e.revision||0,url:e.url,categories:[e.category],busyStatus:'FREE',
  description:[e.detail,`Timezone: ${e.timezone}`,`Source: ${e.url}`,`Verified: ${e.last_verified||'unknown'}`,`Status: ${e.status}`].join('\n'),
 }));
 const {error,value}=createEvents(rows,{productId:`oh-earnings-cal/${slug}`,calName:slug==='macro'?'市场宏观与央行日历':'重点公司活动日历',method:'PUBLISH'});
 if(error)throw error;
 // A new build's DTSTAMP does NOT mean upstream data is fresh. JSON source timestamps are separate.
 const stamp=now.replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 return value.replace(/^DTSTAMP:[^\r\n]*/gm,`DTSTAMP:${stamp}`).replace('BEGIN:VCALENDAR\r\n',`BEGIN:VCALENDAR\r\nX-GENERATED-AT:${stamp}\r\n`);
}
export async function publishCalendar(state,now) {
  await mkdir(ICS_DIR,{recursive:true});
 await mkdir(`${DATA_DIR}/market-calendar/published`,{recursive:true});
 for(const [slug,category]of [['macro',false],['company-events',true]]) {
  const events=state.events.filter(e=>(e.category==='company')===category);
  const value=calendarIcs(events,slug,now);
  await writeFile(`${ICS_DIR}/${slug}.ics`,value);
  await writeFile(`${DATA_DIR}/market-calendar/published/${slug}.ics`,value);
 }
 // Public event data only. No watchlist, holdings, private context or secrets.
 await writeFile(`${ICS_DIR}/market-calendar.json`,JSON.stringify({...state,schema_version:1,generated_at:now},null,2)+'\n');
 await writeFile(`${DATA_DIR}/market-calendar/published/market-calendar.json`,JSON.stringify({...state,schema_version:1,generated_at:now},null,2)+'\n');
}
