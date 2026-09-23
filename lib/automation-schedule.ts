type Schedule = { frequency: string; postingDays: string[]; postingTime: string; timezone: string };
export function nextScheduledRun(schedule: Schedule, after = Date.now()) {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: schedule.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const days = schedule.postingDays;
  for (let time = Math.floor(after / 60000) * 60000 + 60000; time <= after + 8 * 86400000; time += 60000) {
    const parts = Object.fromEntries(format.formatToParts(time).map(part => [part.type, part.value]));
    if (`${parts.hour}:${parts.minute}` === schedule.postingTime && (schedule.frequency === "daily" || days.includes(parts.weekday))) return new Date(time).toISOString();
  }
  throw new Error("Choose a valid run time and at least one scheduled day.");
}
