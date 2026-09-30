// Logic tests for time/stats/store/data. Run: tools/test.sh  (JavaScriptCore, local TZ)
import * as T from '../js/time.js';
import { computeWeekStats, computeAwards, leaderboard, computeTrends, tabScore } from '../js/stats.js';
import * as S from '../js/store.js';
import * as D from '../js/data.js';
import { clusterPins, distanceM } from '../js/geomath.js';
import { setClockOffset } from '../js/clock.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) print(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`);
};
const ts = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const at = t => setClockOffset(t - Date.now());

// ---- time ----
eq('tabDay 5:59am -> prev', T.tabDayKey(ts(2026, 10, 3, 5, 59)), '2026-10-02');
eq('tabDay 6:00am -> same', T.tabDayKey(ts(2026, 10, 3, 6, 0)), '2026-10-03');
eq('tabDay rollover 3', T.tabDayKey(ts(2026, 10, 3, 4, 0), 3), '2026-10-03');
eq('tabDay midnight', T.tabDayKey(ts(2026, 10, 3, 0, 0)), '2026-10-02');
eq('weekKey sunday', T.weekKeyOf('2026-10-04'), '2026-09-28');
eq('weekKey monday', T.weekKeyOf('2026-09-28'), '2026-09-28');
eq('month boundary range', T.formatWeekRange('2026-09-28'), 'Sep 28 – Oct 4');
eq('week number', T.weekNumber('2026-09-28'), 40);
eq('week number y/e', T.weekNumber('2025-12-29'), 1);
// Mon 3 AM: still Sunday's tab day → current week = last week, prev dropped a week ago
eq('mon 3am current week', T.currentWeekKey(ts(2026, 10, 5, 3, 0)), '2026-09-28');
eq('mon 3am latest dropped', T.latestDroppedWeekKey(ts(2026, 10, 5, 3, 0)), '2026-09-21');
eq('mon 3am next drop', T.nextDrop(ts(2026, 10, 5, 3, 0)), { weekKey: '2026-09-28', ts: ts(2026, 10, 5, 12), cooking: false });
eq('mon 7am cooking', T.nextDrop(ts(2026, 10, 5, 7, 0)).cooking, true);
eq('mon 7am pending', T.pendingDropWeekKey(ts(2026, 10, 5, 7, 0)), '2026-09-28');
eq('mon 11:59 latest dropped', T.latestDroppedWeekKey(ts(2026, 10, 5, 11, 59)), '2026-09-21');
eq('mon 12:00 latest dropped', T.latestDroppedWeekKey(ts(2026, 10, 5, 12, 0)), '2026-09-28');
eq('mon 12:00 next drop', T.nextDrop(ts(2026, 10, 5, 12, 0)), { weekKey: '2026-10-05', ts: ts(2026, 10, 12, 12), cooking: false });
eq('editable days tue', T.editableDayKeys(ts(2026, 9, 29, 17)), ['2026-09-28', '2026-09-29']);
eq('editable: future', T.isDayEditable('2026-09-30', ts(2026, 9, 29, 17)), false);
eq('editable: locked', T.isDayEditable('2026-09-27', ts(2026, 9, 29, 17)), false);
eq('editable: cooking sunday', T.isDayEditable('2026-10-04', ts(2026, 10, 5, 11)), true);
eq('editable: after drop sunday', T.isDayEditable('2026-10-04', ts(2026, 10, 5, 12)), false);
// DST fall back: Sun Nov 1 2026 (US). Week of Oct 26 drops Mon Nov 2 12:00 local.
eq('dst drop ts', new Date(T.dropTs('2026-10-26')).getHours(), 12);
eq('dst tabDay 1:30am nov1', T.tabDayKey(ts(2026, 11, 1, 1, 30)), '2026-10-31');
eq('dst weekDays', T.weekDays('2026-10-26'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
eq('dst addDays', T.addDays('2026-10-31', 2), '2026-11-02');
eq('spring dst addDays', T.addDays('2026-03-07', 2), '2026-03-09');
eq('daysBetween dst', T.daysBetween('2026-10-31', '2026-11-02'), 2);
// attribution
const ses = { dayKey: '2026-10-02' };
eq('attr: session keeps friday at 3am sat', T.attributeDayKey(ts(2026, 10, 3, 3), 6, ses), '2026-10-02');
eq('attr: session keeps friday at 11am sat', T.attributeDayKey(ts(2026, 10, 3, 11), 6, ses), '2026-10-02');
eq('attr: no session 11am sat', T.attributeDayKey(ts(2026, 10, 3, 11), 6, null), '2026-10-03');
const sunSes = { dayKey: '2026-10-04' };
eq('attr: sunday session mon 9am (cooking)', T.attributeDayKey(ts(2026, 10, 5, 9), 6, sunSes), '2026-10-04');
eq('attr: sunday session mon 1pm (dropped) -> own day', T.attributeDayKey(ts(2026, 10, 5, 13), 6, sunSes), '2026-10-05');
eq('countdown parts', T.countdownParts(90061000), { days: 1, hours: 1, minutes: 1, seconds: 1, done: false });
eq('formatTime', T.formatTime(ts(2026, 10, 3, 0, 5)), '12:05 AM');
eq('formatDuration', T.formatDuration(3 * 3600e3 + 12 * 60e3), '3h 12m');

// ---- stats ----
const L = (cat, sub, dayKey, h, extra = {}) => ({ id: Math.random().toString(36), cat, sub, dayKey, ts: T.tsAt(dayKey, h), sessionId: null, loc: null, manual: false, ...extra });
const logs = [
  L('drinks', 'beer', '2026-09-25', 22), L('drinks', 'beer', '2026-09-25', 23), L('drinks', 'wine', '2026-09-26', 21),
  L('drinks', 'mixed', '2026-09-26', 26), L('shots', null, '2026-09-26', 27), L('cigs', null, '2026-09-26', 25),
  L('bong', null, '2026-09-22', 16), L('drinks', 'beer', '2026-09-28', 20), // next week — excluded
];
const st = computeWeekStats({ weekKey: '2026-09-21', logs });
eq('totals', st.totals, { drinks: 4, shots: 1, cigs: 1, joints: 0, edibles: 0, bong: 1 });
eq('drinkTypes', st.drinkTypes, { beer: 2, seltzer: 0, wine: 1, mixed: 1, other: 0 });
eq('std drinks', st.stdDrinks, 5.5);
eq('score', st.score, tabScore(st.totals));
eq('score value', st.score, 4 + 1.5 + 0.5 + 0.5);
eq('busiest', st.busiestDay.dayKey, '2026-09-26');
eq('latest log is 3am sat', new Date(st.latestLog.ts).getHours(), 3);
eq('active days', st.activeDays, 3);
eq('spend default', st.spend, 32); // 2 beer $8 + wine $8 + mixed $9 + shot $5 + cig $0.5 + bong $1
const empty = computeWeekStats({ weekKey: '2026-09-21', logs: [] });
eq('empty busiest null', empty.busiestDay, null);
eq('empty score', empty.score, 0);
// leaderboard ties
const lb = leaderboard([{ userId: 'a', stats: { ...st, score: 5 } }, { userId: 'b', stats: { ...st, score: 5 } }, { userId: 'c', stats: { ...st, score: 2 } }, { userId: 'd', stats: null }], 'score');
eq('leaderboard dense ties', lb.map(r => [r.userId, r.rank]), [['a', 1], ['b', 1], ['c', 3]]);
// awards
const aw = computeAwards([{ userId: 'me', stats: st }, { userId: 'x', stats: empty }]);
eq('awards choir boy to empty', aw.find(a => a.id === 'choir-boy').winnerIds, ['x']);
eq('no chimney tie at zero? chimney to me', aw.find(a => a.id === 'chimney').winnerIds, ['me']);
eq('no joint award when all zero', !!aw.find(a => a.id === 'joint-venture'), false);
eq('single member no awards', computeAwards([{ userId: 'me', stats: st }]), []);
eq('night owl label', aw.find(a => a.id === 'night-owl').valueLabel, 'Last log 3:00 AM');
// trends
const tr = computeTrends(st, [empty, null, st]);
eq('trend delta vs prev', tr.byCat.drinks.delta, 4);
eq('trend avg ignores null', tr.byCat.drinks.avg, 2);
eq('trend none prior', computeTrends(st, []).byCat.drinks.delta, null);
// clustering
const pins = [{ lat: 36.15, lng: -86.8 }, { lat: 36.1501, lng: -86.8001 }, { lat: 36.16, lng: -86.78 }];
const cl = clusterPins(pins, [{ id: 's1', name: 'Home', lat: 36.15, lng: -86.8 }]);
eq('clusters', cl.map(c => [c.name, c.count]), [['Home', 2], ['Stop 1', 1]]);
eq('distance ~1.1km', Math.round(distanceM({ lat: 36.15, lng: -86.8 }, { lat: 36.16, lng: -86.8 }) / 10), 111);

// ---- store + data: full flow on a fixed clock ----
at(ts(2026, 9, 29, 17));
S.resetAll();
S.completeOnboarding({ name: 'Test', handle: '@Test.User', demo: false });
eq('handle normalized', S.getState().me.handle, 'test.user');
eq('no demo: no friends', D.friendIds(), []);
eq('no demo: latest week null', D.weekStats('me', D.latestDropWeek()), null);
eq('no demo: unseen null', D.unseenDrop(), null);
eq('no demo: suggestions empty', D.suggestions().length, 0);
S.addLog('drinks', 'beer');
eq('current week hidden', D.weekStats('me', '2026-09-28'), null);
eq('current week allowUndropped', D.weekStats('me', '2026-09-28', { allowUndropped: true }).totals.drinks, 1);
// Friday night session crossing midnight
at(ts(2026, 10, 2, 22));
const sesn = S.startSession({});
S.addLog('shots');
at(ts(2026, 10, 3, 2, 30));
const late = S.addLog('drinks', 'mixed');
eq('late log -> friday', late.dayKey, '2026-10-02');
eq('late log in session', late.sessionId, sesn.id);
at(ts(2026, 10, 3, 9));
const morning = S.addLog('cigs'); // still in session (idle < 5h? last 2:30 → 6.5h → should time out first when checked)
eq('session still attached if not checked', morning.dayKey, '2026-10-02');
S.deleteLog(morning.id);
const ended = S.checkSessionTimeout();
eq('timeout ends session', !!ended && ended.end === ts(2026, 10, 3, 3, 0), true);
const after = S.addLog('cigs');
eq('after end -> saturday', after.dayKey, '2026-10-03');
// back-fill + locking across the drop
at(ts(2026, 10, 5, 9)); // cooking
const bf = S.addLog('joints', null, { dayKey: '2026-10-04' });
eq('backfill sunday during cooking', [bf.dayKey, bf.manual], ['2026-10-04', true]);
eq('cooking week hidden', D.weekStats('me', '2026-09-28'), null);
at(ts(2026, 10, 5, 12, 1));
const w = D.weekStats('me', '2026-09-28');
eq('dropped totals', w.totals, { drinks: 2, shots: 1, cigs: 1, joints: 1, edibles: 0, bong: 0 });
eq('dropped week sessions', w.sessions.length, 1);
let threw = false; try { S.addLog('joints', null, { dayKey: '2026-10-04' }); } catch (e) { threw = e instanceof S.LockedDayError; }
eq('locked after drop', threw, true);
threw = false; try { S.removeLog('joints', null, '2026-10-04'); } catch (e) { threw = e instanceof S.LockedDayError; }
eq('remove locked after drop', threw, true);
eq('unseen drop now', D.unseenDrop(), '2026-09-28');
S.markDropSeen('2026-09-28');
eq('seen', D.unseenDrop(), null);
eq('dropped weeks me', D.droppedWeeks('me'), ['2026-09-28']);
// back-fill rough times (cooking window gone; use an editable day of the new week)
at(ts(2026, 10, 7, 15)); // Wed 3 PM
const bfEarly = S.addLog('shots', null, { dayKey: '2026-10-05', at: 'early' });
const bfAfter2 = S.addLog('shots', null, { dayKey: '2026-10-05', at: 'after2' });
eq('backfill early ~8pm', new Date(bfEarly.ts).getHours(), 20);
eq('backfill after2 ~2am next morning, same tab day', [new Date(bfAfter2.ts).getHours(), T.tabDayKey(bfAfter2.ts)], [2, '2026-10-05']);
eq('backfill default ~11pm', new Date(S.addLog('cigs', null, { dayKey: '2026-10-06' }).ts).getHours(), 23);
// adopt recent logs into a new session
at(ts(2026, 10, 7, 22));
const pre1 = S.addLog('drinks', 'beer');
at(ts(2026, 10, 7, 22, 30));
const ses2 = S.startSession({});
eq('adopt recent logs', S.adoptLogsIntoSession(ses2.id, ts(2026, 10, 7, 20)), 1);
eq('adopted log has session', S.getState().logs.find(l => l.id === pre1.id).sessionId, ses2.id);
S.endSession(ses2.id);
at(ts(2026, 10, 5, 12, 1));
// setCount
S.setCount('2026-10-05', 'drinks', 'seltzer', 3);
eq('setCount up', D.dayTotals('2026-10-05').drinkTypes.seltzer, 3);
S.setCount('2026-10-05', 'drinks', 'seltzer', 1);
eq('setCount down', D.dayTotals('2026-10-05').drinkTypes.seltzer, 1);
// demo world + friends privacy
S.loadDemoData();
eq('demo friends', D.friendIds().length, 8);
const fw = D.weekStats('jordan', D.latestDropWeek());
eq('friend pins stripped', fw.pins, []);
eq('friend spots no coords', fw.spots.every(s => s.lat === undefined && s.lng === undefined), true);
eq('friend current week hidden', D.weekStats('jordan', D.thisWeek()), null);
eq('friend areas snapped to grid', fw.areas.length > 0 && fw.areas.every(a => Math.abs(a.lat / 0.004 - Math.round(a.lat / 0.004)) < 1e-6 && a.radiusM >= 400), true);
eq('friend areas carry names', fw.areas.every(a => typeof a.name === 'string' && a.count > 0), true);
eq('friend before join null', D.weekStats('grace', T.prevWeekKey(D.latestDropWeek(), 10)), null);
const cw = D.compareWeek(D.circleIds(), D.latestDropWeek());
eq('compare has boards', Object.keys(cw.boards).sort(), ['bong','cigs','drinks','edibles','joints','score','shots','spend','stdDrinks']);
S.sendFriendRequest('luke'); // luke has an incoming request → accept
eq('request back = accept', D.isFriend('luke'), true);
S.sendFriendRequest('olivia');
eq('outgoing', D.relationTo('olivia'), 'outgoing');
at(ts(2026, 10, 5, 12, 2));
eq('demo auto-accept', S.resolveDemoRequests(), ['olivia']);
S.removeFriend('maya');
eq('removed from groups', S.getState().groups.every(g => !g.memberIds.includes('maya')), true);
const g = S.createGroup({ name: '  Test Crew ', emoji: '🎉', memberIds: ['jordan', 'me'] });
eq('group me first, no dup', g.memberIds, ['me', 'jordan']);
eq('group name trimmed', g.name, 'Test Crew');
eq('group week', !!D.groupWeek(g.id, D.latestDropWeek()).boards.score.length, true);
S.clearDemoData();
eq('clear demo keeps real logs', S.getState().logs.some(l => l.id.startsWith('demo-')), false);
eq('clear demo keeps my real logs', S.getState().logs.length > 0, true);

setClockOffset(0);
print(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`);
