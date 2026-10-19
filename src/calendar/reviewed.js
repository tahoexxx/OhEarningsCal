import { event } from './core.js';

// Hosts a reviewed company event may cite. Keep in sync with byreal-biz market_calendar.py ALLOWED_HOSTS.
export const OVERRIDE_HOSTS=new Set(['developer.apple.com','www.apple.com','x.com','www.nvidia.com','ignite.microsoft.com','aws.amazon.com','www.computextaipei.com.tw']);

// A reviewed override must cite an allowed official source and quote the dated evidence found there.
export function reviewedEvent(o) {
 if(!o.id||!o.last_verified||!o.evidence||!o.reviewed_by)throw Error(`Invalid reviewed override ${o.id}`);
 const url=new URL(o.url);
 if(url.protocol!=='https:'||!OVERRIDE_HOSTS.has(url.hostname))throw Error(`Untrusted override source ${o.id}`);
 if(!Array.isArray(o.tickers)||(o.category||'company')!=='company')throw Error(`Invalid override category/tickers ${o.id}`);
 const {zone,...rest}=o;
 return event({...rest,zone:zone||o.timezone||'America/New_York',category:'company'});
}
