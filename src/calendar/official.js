import { load } from 'cheerio';
import { MONTHS,clean,day,clock,event,hash,shift } from './core.js';

export const FED='https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
export const BEA='https://www.bea.gov/news/schedule';
export const APPLE='https://developer.apple.com/news/rss/news.rss';

export function parseFed(html,year) {
 const $=load(html);const out=[];
 $('.panel').each((_,p)=>{
  if(!new RegExp(`^${year} FOMC Meetings$`).test(clean($(p).find('.panel-heading').first().text()))) return;
  $(p).find('.fomc-meeting').each((_,r)=>{
   const month=clean($(r).find('.fomc-meeting__month').text());
   const dates=clean($(r).find('.fomc-meeting__date').text());
   const m=dates.match(/^(\d{1,2})-(\d{1,2})(\*)?$/);
   if(!m) return; // Skip notation votes; never guess an irregular meeting.
   const parts=month.split('/');
   const resolveMonth=s=>MONTHS.findIndex(n=>n.toLowerCase().startsWith(s.toLowerCase()))+1;
   const sm=resolveMonth(parts[0]),em=resolveMonth(parts.at(-1));
   if(!sm||!em) throw Error('Unknown Fed month');
   const start=day(year,sm,+m[1]),end=day(year,em,+m[2]);
   out.push({start,end,sep:Boolean(m[3])});
  });
 });
 if(out.length<6||out.length>10) throw Error(`Fed calendar parse rejected: ${out.length} meetings for ${year}`);
 return out;
}
export function fedAnnualEvents(meetings) {
 return meetings.flatMap(m=>[
  event({id:`fed-meeting-${m.start}`,title:'FOMC 会议',date:m.start,category:'central_bank',url:FED,source:'fed',end_date:shift(m.end,1),detail:`美东日期 ${m.start} 至 ${m.end}；${m.sep?'本场含 SEP / 点阵图':'常规会议'}。未来会议安排可能调整。`}),
  event({id:`fed-decision-${m.start}`,title:m.sep?'FOMC 决议 · SEP / 点阵图':'FOMC 利率决议',date:m.end,category:'central_bank',url:FED,source:'fed',parent_id:`fed-meeting-${m.start}`,detail:'会议结束日；具体时刻以 Fed 月历为准。'})
 ]);
}
export function parseFedMonth(html,year,month,meetings) {
 const $=load(html),out=[];const url=`https://www.federalreserve.gov/newsevents/${year}-${MONTHS[month-1].toLowerCase()}.htm`;
 if(!clean($('h4').text()).includes(`${MONTHS[month-1]} ${year}`)) throw Error('Fed month heading mismatch');
 $('.panel-body > .row').each((_,r)=>{
  const cols=$(r).children('div');if(cols.length!==3)return;
  // A meeting row also mentions its press conference in a secondary paragraph.
  const title=clean($(cols[1]).children('p').first().text()),time=clock($(cols[0]).text()),dates=clean($(cols[2]).text());
  if(!/FOMC (Meeting|Press Conference|Minutes)/i.test(title)||!/^\d{1,2}$/.test(dates))return;
  const date=day(year,month,+dates);let id,label,parent;
  if(/Minutes/.test(title)) {
   id=`fed-minutes-${date}`;label='FOMC 会议纪要';
  } else {
   const m=meetings.find(m=>m.end===date);if(!m) throw Error('Fed monthly/annual dates conflict');
   parent=`fed-meeting-${m.start}`;
   if(/Press Conference/.test(title)){id=`fed-press-${m.start}`;label='FOMC 新闻发布会';}
   else {id=`fed-decision-${m.start}`;label=m.sep?'FOMC 利率决议 · 本场含 SEP':'FOMC 利率决议';}
  }
  out.push(event({id,title:label,date,time,category:'central_bank',url,source:'fed',parent_id:parent,detail:title}));
 });
 return out;
}
export function parseBea(html) {
 const $=load(html),out=[];
 $('table').each((_,table)=>{
  const year=clean($(table).find('thead').text()).match(/Year (\d{4})/);if(!year)return;
  $(table).find('tbody tr').each((_,r)=>{
   const title=clean($(r).find('.release-title').text());
   if(!/^(Personal Income and Outlays|GDP \()/.test(title))return;
   const ds=clean($(r).find('.release-date').text()).match(/^(\w+) (\d+)$/);
   const time=clock($(r).find('small').text());if(!ds||!time)throw Error('BEA date/time parse failed');
   const month=MONTHS.indexOf(ds[1])+1;if(!month)throw Error('BEA month unknown');
   out.push(event({id:`bea-${hash(title).slice(0,20)}`,title:title.startsWith('GDP')?`美国 GDP · ${title.match(/\(([^)]+)\)/)?.[1]||''}`:'美国 PCE / 核心 PCE',date:day(+year[1],month,+ds[2]),time,url:BEA,source:'bea',detail:title}));
  });
 });
 if(!out.length)throw Error('BEA calendar empty/changed');
 return out;
}
export function parseApple(xml,now) {
 const $=load(xml,{xmlMode:true});const events=[],candidates=[];
 if(!$('item').length)throw Error('Apple RSS invalid/empty');
 for(const r of $('item').toArray()) {
  const url=$(r).find('link').text().trim();
  if(!url.startsWith('https://developer.apple.com/'))continue;
  const title=clean($(r).find('title').text()),body=clean($(r).find('description').text());
  const pub=new Date($(r).find('pubDate').text());if(!Number.isFinite(+pub))continue;
  if(!/special Apple Event|WWDC\d*.*(?:June|keynote)|Worldwide Developers Conference/i.test(body))continue;
  if(pub.toISOString().slice(0,10)<shift(now.slice(0,10),-370))continue;
  const match=body.match(/special Apple Event on (\w+) (\d{1,2})(?:,? (20\d{2}))? at (\d{1,2}(?::\d{2})?\s*[ap]\.m\.)\s*(PT|PDT|PST)/i);
  if(!match) {candidates.push({id:hash(url).slice(0,20),title,url,published:pub.toISOString(),reason:'Official announcement needs date/time review',evidence:body.slice(0,1800)});continue;}
  const month=MONTHS.indexOf(match[1])+1,year=match[3]?+match[3]:pub.getUTCFullYear();
  const date=day(year,month,+match[2]);
  if(!month||date<shift(pub.toISOString().slice(0,10),-1)||date>shift(pub.toISOString().slice(0,10),120))continue;
  events.push(event({id:`apple-special-${year}-${String(month).padStart(2,'0')}`,title:'Apple 特别发布会',date,time:clock(match[4]),zone:'America/Los_Angeles',category:'company',url,source:'apple',tickers:['AAPL'],detail:`${title}；${match[0]}`,evidence:match[0],published:pub.toISOString()}));
 }
 return {events,candidates};
}
