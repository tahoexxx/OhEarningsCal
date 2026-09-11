import { clock,event,shift,zonedUtc } from './core.js';

export const NASDAQ='https://api.nasdaq.com/api/calendar/economicevents';
// Official BLS schedule snapshot, verified 2026-09-11. Calibration only, never emitted as live data.
// These anchors expire; after expiry Nasdaq is withheld unless Fed monthly dates/times calibrate it.
// Sources: https://www.bls.gov/schedule/news_release/{cpi,ppi}.htm
export const BLS_ANCHORS=[
 ['CPI','2026-09-11'],['PPI','2026-09-10'],['CPI','2026-10-14'],['PPI','2026-10-15'],
 ['CPI','2026-11-10'],['PPI','2026-11-13'],['CPI','2026-12-10'],['PPI','2026-12-15'],
].map(([name,date])=>({name,date,time:'08:30',zone:'America/New_York'}));

export function calibrate(days,anchors=BLS_ANCHORS) {
 const observations=[];
 for(const d of days)for(const r of d.rows) {
  if(r.country!=='United States')continue;
  const possible=anchors.filter(a=>a.name===r.eventName&&Math.abs(Date.parse(a.date)-Date.parse(d.query))<=86400000);
  if(possible.length===1)observations.push({query:d.query,row:r,anchor:possible[0]});
 }
 const proofs=[...new Map(observations.map(o=>[`${o.row.eventName}:${o.anchor.date}:${o.query}:${o.row.gmt}`,o])).values()];
 if(new Set(proofs.map(o=>`${o.row.eventName}:${o.anchor.date}`)).size<2)throw Error('Nasdaq calibration needs at least two official event anchors; publishing withheld');
 const solutions=[];
 for(const offset of [-1,0,1])for(const zone of ['America/New_York','UTC']) {
  if(proofs.every(o=>shift(o.query,offset)===o.anchor.date&&clock(o.row.gmt)&&zonedUtc(o.anchor.date,clock(o.row.gmt),zone)===zonedUtc(o.anchor.date,o.anchor.time,o.anchor.zone)))solutions.push({offset,zone});
 }
 if(solutions.length!==1)throw Error('Nasdaq date/time convention changed or conflicts with official anchors; publishing withheld');
 return {...solutions[0],proofs:proofs.map(o=>({event:o.row.eventName,query:o.query,official_date:o.anchor.date,time:o.row.gmt}))};
}
const classify=name=> /^(Core )?CPI(?:$| Index|,)/.test(name)?['cpi','美国 CPI / 核心 CPI']:
 /^(Core )?PPI(?:$| ex\.)/.test(name)?['ppi','美国 PPI / 核心 PPI']:
 /^(Nonfarm Payrolls|Unemployment Rate|Average Hourly Earnings)$/.test(name)?['employment','美国非农 / 失业率']:null;
export function parseNasdaq(days,calibration) {
 const events=new Map();
 for(const d of days)for(const r of d.rows) {
  if(r.country!=='United States')continue;
  const kind=classify(r.eventName);if(!kind)continue;
  const date=shift(d.query,calibration.offset),time=clock(r.gmt);
  if(!time)throw Error('Selected Nasdaq event lacks an exact time');
  if([0,6].includes(new Date(date+'T12:00:00Z').getUTCDay()))throw Error('Selected US release unexpectedly falls on weekend');
  const id=`nasdaq-${kind[0]}-${date.slice(0,7)}`;
  const e=event({id,title:kind[1],date,time,zone:calibration.zone,url:`https://www.nasdaq.com/market-activity/economic-calendar?date=${d.query}`,source:'nasdaq',status:'scheduled',detail:'Nasdaq 日程；前瞻有限，未列出不表示没有事件。日期/时区已按官方锚点校准；未引入实际值或预测值。'});
  if(events.has(id)&&(events.get(id).start!==e.start))throw Error('Ambiguous Nasdaq monthly release identity; manual review required');
  events.set(id,e);
 }
 return [...events.values()];
}
