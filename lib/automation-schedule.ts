export type AutomationSchedule = { frequency:string; postingDays:string[]; postingTime:string; timezone:string; postingTimes?:string[]; intervalDays?:number; scheduleStartDate?:string };
export const scheduleDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export const scheduleDayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const dayMs=86400000;
const dateParts=(format:Intl.DateTimeFormat,time:number)=>Object.fromEntries(format.formatToParts(time).map(part=>[part.type,part.value]));
export function calendarDateInZone(timezone:string,time=Date.now()) {
  const p=dateParts(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}),time);
  return `${p.year}-${p.month}-${p.day}`;
}
export function scheduleTimes(schedule:Pick<AutomationSchedule,'postingTime'|'postingTimes'>) { return schedule.postingTimes===undefined?[schedule.postingTime]:schedule.postingTimes; }
export function normalizeAutomationSchedule(input:Record<string,unknown>):AutomationSchedule {
  const frequency=String(input.frequency||'weekly');
  if(!['daily','weekly','custom','interval'].includes(frequency))throw new Error('Choose Weekly schedule or Every X days.');
  const timezone=String(input.timezone||'Asia/Kuala_Lumpur'),today=calendarDateInZone(timezone);
  const rawTimes=input.postingTimes===undefined?[input.postingTime===undefined?'10:00':input.postingTime]:input.postingTimes;
  if(!Array.isArray(rawTimes)||!rawTimes.length||rawTimes.length>1440||rawTimes.some(time=>typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))throw new Error('Add at least one valid run time.');
  const postingTimes=[...rawTimes] as string[];
  if(new Set(postingTimes).size!==postingTimes.length)throw new Error('Each run time must be different.');
  postingTimes.sort();
  const postingDays=Array.isArray(input.postingDays)?input.postingDays.map(String):[];
  if((frequency==='weekly'||frequency==='custom')&&(!postingDays.length||postingDays.some(day=>!scheduleDays.includes(day))))throw new Error('Choose at least one weekday.');
  const result:AutomationSchedule={frequency,postingTimes,postingTime:postingTimes[0],postingDays:[...new Set(postingDays)],timezone};
  if(frequency==='interval') {
    const intervalDays=Number(input.intervalDays);
    if(!Number.isSafeInteger(intervalDays)||intervalDays<1||intervalDays>36500)throw new Error('Enter a whole number of days between 1 and 36500.');
    const start=input.scheduleStartDate===undefined?today:String(input.scheduleStartDate);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isFinite(Date.parse(start))||new Date(start).toISOString().slice(0,10)!==start)throw new Error('Choose a valid start date.');
    result.intervalDays=intervalDays;result.scheduleStartDate=start;
  }
  return result;
}
// Calendar-day recurrence keeps wall-clock times stable across DST. Offset probes
// yield UTC candidates for each local slot without scanning months of minutes.
export function nextScheduledRun(schedule:AutomationSchedule,after=Date.now()) {
  const s=normalizeAutomationSchedule(schedule);
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:s.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const today=Date.parse(calendarDateInZone(s.timezone,after)),anchor=Date.parse(s.scheduleStartDate||calendarDateInZone(s.timezone,after));
  let date=today;
  if(s.frequency==='interval')date=anchor+Math.max(0,Math.ceil((today-anchor)/dayMs/s.intervalDays!))*s.intervalDays!*dayMs;
  for(let attempt=0;attempt<16;attempt++,date+=(s.frequency==='interval'?s.intervalDays!:1)*dayMs) {
    const localDate=new Date(date).toISOString().slice(0,10);
    if((s.frequency==='weekly'||s.frequency==='custom')&&!s.postingDays.includes(scheduleDays[(new Date(date).getUTCDay()+6)%7]))continue;
    const offsets=new Set<number>();
    for(const hours of [-36,-12,0,12,36]){const probe=date+hours*3600000,p=dateParts(format,probe);offsets.add(Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute))-probe);}
    const candidates:number[]=[];
    for(const slot of s.postingTimes!) {
      const [hour,minute]=slot.split(':').map(Number);
      const matches=[...offsets].map(offset=>date+hour*3600000+minute*60000-offset).filter(time=>{const p=dateParts(format,time);return `${p.year}-${p.month}-${p.day}`===localDate&&`${p.hour}:${p.minute}`===slot;}).sort((a,b)=>a-b);
      // Repeated autumn wall-clock slots run once; missing spring slots skip.
      if(matches.length&&matches[0]>after)candidates.push(matches[0]);
    }
    if(candidates.length)return new Date(Math.min(...candidates)).toISOString();
  }
  throw new Error('No valid upcoming run time. Choose another time or schedule.');
}
export function describeSchedule(schedule:AutomationSchedule) {
  const cadence=schedule.frequency==='interval'?`Every ${schedule.intervalDays} ${schedule.intervalDays===1?'day':'days'}, starting ${schedule.scheduleStartDate}`:schedule.frequency==='daily'?'Every day':scheduleDays.filter(day=>schedule.postingDays.includes(day)).map(day=>scheduleDayNames[scheduleDays.indexOf(day)]).join(', ');
  return `${cadence} · ${scheduleTimes(schedule).join(', ')} (${schedule.timezone})`;
}
