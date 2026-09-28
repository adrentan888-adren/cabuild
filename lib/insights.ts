import type { Asset, CompetitorResult, Platform, PublishItem, SocialAudit } from './types';
import { contentCreatorQueue } from './content-origin';

export type ConnectedAccount = { platform:Platform; handle:string; displayName:string; imageUrl?:string; reauthRequired?:boolean; url:string };
export type InsightsData = { workspace:{id:string}; connectedSocialAccounts:ConnectedAccount[]; socialAudits:SocialAudit[]; competitorResults:CompetitorResult[]; assets:Asset[]; publishQueue:PublishItem[] };
export const insightPeriods = [{value:'all',label:'All saved data'},{value:'7',label:'Last 7 days'},{value:'30',label:'Last 30 days'},{value:'90',label:'Last 90 days'}];
export const insightPlatforms:Platform[] = ['TikTok','Instagram','YouTube','LinkedIn','Facebook','X'];
export const count = (value:number) => new Intl.NumberFormat('en', {maximumFractionDigits:0}).format(value);
export function validTime(value?:string) { const time=Date.parse(value||''); return Number.isFinite(time)?time:null; }
export function inPeriod(value:string|undefined,period:string,now=Date.now()) { const time=validTime(value);return period==='all'||(time!==null&&time<=now&&time>=now-Number(period)*86400000); }
export function dateLabel(value?:string) { return validTime(value)!==null?new Date(value!).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Not recorded'; }
export function safeUrl(value?:string) { if(!value)return undefined;try { const url=new URL(value);return ['http:','https:'].includes(url.protocol)?value:undefined; }catch{return value.startsWith('/')&&!value.startsWith('//')?value:undefined;} }
export function metricValue(value:number) { return Number.isFinite(value)&&value>=0?value:0; }
export function auditAccounts(data:InsightsData) {
  return data.connectedSocialAccounts.map(account=>{
    const audit=data.socialAudits.filter(row=>row.workspaceId===data.workspace.id&&row.platform===account.platform&&row.handle.toLowerCase().replace(/^@/,'')===account.handle.toLowerCase().replace(/^@/,''))
      .sort((a,b)=>(validTime(b.createdAt)||0)-(validTime(a.createdAt)||0))[0];
    const usable=Boolean(audit&&audit.source==='apify'&&!audit.error);
    const posts=usable?data.competitorResults.filter(post=>post.workspaceId===data.workspace.id&&post.competitorId===audit.id):[];
    return {account,audit,usable,posts};
  });
}
export function postMetrics(posts:CompetitorResult[]) {
  const views=posts.reduce((sum,row)=>sum+metricValue(row.views),0),likes=posts.reduce((sum,row)=>sum+metricValue(row.likes),0),comments=posts.reduce((sum,row)=>sum+metricValue(row.comments),0);
  // Only posts with a view denominator contribute to a likes / views ratio.
  const rated=posts.filter(row=>metricValue(row.views)>0),ratedLikes=rated.reduce((sum,row)=>sum+metricValue(row.likes),0);
  return {views,likes,comments,rate:views>0?ratedLikes/views*100:null,ratedPosts:rated.length};
}
export const outputStatuses = [{value:'draft',label:'Draft'},{value:'generating',label:'Generating'},{value:'done',label:'Ready'},{value:'scheduled',label:'Scheduled'},{value:'published',label:'Published'},{value:'failed',label:'Failed'}];
export function creatorOutputs(data:InsightsData) {
  const assets=data.assets.filter(asset=>asset.workspaceId===data.workspace.id);
  return contentCreatorQueue(data.publishQueue.filter(item=>item.workspaceId===data.workspace.id),assets).map(item=>{
    const asset=assets.find(row=>row.id===item.assetId);
    return {item,asset,createdAt:item.createdAt||asset?.createdAt,type:item.generationType||asset?.type||'unknown'};
  });
}
