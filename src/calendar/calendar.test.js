import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zonedUtc,mergeEvents,event } from './core.js';
import {parseFed,parseFedMonth,parseApple,parseBea} from './official.js';
import {calibrate,parseNasdaq} from './nasdaq.js';
import {calendarIcs} from './publish.js';
const fixture=n=>readFileSync(new URL(`fixtures/${n}`,import.meta.url),'utf8');
const days=['11','12','17'].map(d=>JSON.parse(fixture(`nasdaq-2026-09-${d}.json`)));
const now='2026-09-11T11:00:00.000Z';
test('IANA conversion preserves summer, winter and Beijing cross-day instants',()=>{
 assert.equal(zonedUtc('2026-09-16','14:00','America/New_York'),'2026-09-16T18:00:00.000Z');
 assert.equal(zonedUtc('2026-12-09','14:00','America/New_York'),'2026-12-09T19:00:00.000Z');
 assert.equal(zonedUtc('2026-09-09','10:00','America/Los_Angeles'),'2026-09-09T17:00:00.000Z');
 assert.throws(()=>zonedUtc('2026-03-08','02:30','America/New_York'));
});
test('live Nasdaq fixtures calibrate -1 day and ET, group core/headline CPI',()=>{
 const c=calibrate(days);assert.equal(c.offset,-1);assert.equal(c.zone,'America/New_York');
 const e=parseNasdaq(days,c);assert.equal(e.filter(e=>e.title.includes('CPI')).length,1);
 assert.equal(e.find(e=>e.title.includes('CPI')).start,'2026-09-11T12:30:00.000Z');
 assert.equal(e.find(e=>e.title.includes('PPI')).date,'2026-09-10');
});
test('inconsistent conventions or insufficient anchors fail closed',()=>{
 const bad=structuredClone(days);bad[0].rows.filter(r=>r.eventName==='PPI').forEach(r=>r.gmt='09:30');
 assert.throws(()=>calibrate(bad));assert.throws(()=>calibrate([]));
 const corrected=days.map(d=>({...d,query:new Date(Date.parse(d.query)-86400000).toISOString().slice(0,10)}));
 assert.equal(calibrate(corrected).offset,0); // no permanently hardcoded -1
});
test('Fed annual and monthly agree, distinguish 14:00 decision and 14:30 conference',()=>{
 const m=parseFed(fixture('fed.html'),2026);assert.equal(m.length,8);assert.ok(m.find(m=>m.end==='2026-09-16').sep);
 const events=parseFedMonth(fixture('fed-month.html'),2026,9,m);
 assert.equal(events.find(e=>e.id.startsWith('fed-decision')).start,'2026-09-16T18:00:00.000Z');
 assert.equal(events.find(e=>e.id.startsWith('fed-press')).start,'2026-09-16T18:30:00.000Z');
 assert.throws(()=>parseFed('<html>blocked</html>',2026));
});
test('Apple official announcement, not publication date, supplies event time',()=>{
 const {events}=parseApple(fixture('apple.xml'),now);assert.equal(events.length,1);
 assert.equal(events[0].start,'2026-09-09T17:00:00.000Z');assert.equal(events[0].date,'2026-09-09');
 assert.equal(events[0].tickers[0],'AAPL');
 // Explicitly test missing time with a synthetic announcement, not regex accidents in escaped RSS.
 const uncertain=parseApple('<rss><channel><item><link>https://developer.apple.com/news/?id=x</link><title>Event</title><description>Join us for a special Apple Event on September 9.</description><pubDate>Wed, 26 Aug 2026 08:00:55 PDT</pubDate></item></channel></rss>',now);
 assert.equal(uncertain.events.length,0);assert.equal(uncertain.candidates.length,1);
});
test('BEA separates GDP estimates from PCE and preserves ET release time',()=>{
 const e=parseBea(fixture('bea.html'));assert.equal(e.length,8);
 assert.equal(e.find(e=>e.title.includes('PCE')).start,'2026-09-30T12:30:00.000Z');
 assert.ok(e.some(e=>e.title.includes('Third Estimate')));
});
test('stable IDs, revisions and no duplicate rebuilding; empty source retains prior data',()=>{
 const e=event({id:'a',title:'Release',date:'2026-09-11',time:'08:30',source:'test',url:'https://example.com/'});
 let merged=mergeEvents([], [e], now);merged=mergeEvents(merged,[e],now);assert.equal(merged.length,1);assert.equal(merged[0].revision,0);
 assert.deepEqual(mergeEvents(merged,[],now),merged);
 const updated=event({...e,date:'2026-09-12'});merged=mergeEvents(merged,[updated],now);
 assert.equal(merged.length,1);assert.equal(merged[0].revision,1);assert.equal(merged[0].previous_start,e.start);
});
test('separate ICS has deterministic UID, UTC DTSTART, build DTSTAMP and source verification date',()=>{
 const events=parseApple(fixture('apple.xml'),now).events.map(e=>({...e,last_verified:now}));
 const text=calendarIcs(events,'company-events',now);
 assert.match(text,/UID:apple-special-2026-09@oh-earnings-cal/);
 assert.match(text,/DTSTART:20260909T170000Z/);
 assert.match(text,/DTSTAMP:20260911T110000Z/);
 assert.ok(!text.includes('\r\r\n'));
 assert.ok(!text.includes('VALARM')); // no unsolicited external reminders
 assert.match(calendarIcs([],'macro',now),/BEGIN:VCALENDAR/);
});
