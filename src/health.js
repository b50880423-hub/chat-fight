import http from 'node:http';
import { getISTDayKey, getWeekKey } from './rankingLogic.js';

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function modeFields(mode) {
  if (mode === 'weekly') return { field: '$weeklyMessageCount', match: { weekKey: getWeekKey() } };
  if (mode === 'total') return { field: '$messageCount', match: {} };
  return { field: '$dailyMessageCount', match: { dayKey: getISTDayKey() } };
}

function pageHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChatFight Rankings</title><style>body{margin:0;background:#0b1020;color:#eef2ff;font-family:Inter,Arial,sans-serif}header{padding:38px 7%;background:linear-gradient(135deg,#182449,#512b81)}h1{margin:0;font-size:42px}.sub{opacity:.75;margin-top:8px}.wrap{max-width:1150px;margin:auto;padding:25px 7%}.stats,.grid{display:grid;gap:16px}.stats{grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:-20px}.card{background:#131b31;border:1px solid #263252;border-radius:18px;padding:20px;box-shadow:0 10px 30px #0003}.num{font-size:28px;font-weight:800}.grid{grid-template-columns:repeat(auto-fit,minmax(330px,1fr));margin-top:20px}.tabs{display:flex;gap:8px;margin:20px 0}.tabs button{border:0;border-radius:20px;padding:9px 16px;background:#243153;color:#fff;cursor:pointer}.tabs button.active{background:#7c4dff}ol{margin:0;padding-left:28px}.row{padding:12px 4px;border-bottom:1px solid #263252;display:flex;justify-content:space-between;gap:12px}.muted{color:#9aa7c7;font-size:13px}.name{font-weight:650}a{color:#9dc1ff;text-decoration:none}@media(max-width:600px){h1{font-size:32px}}</style></head><body><header><h1>⚔️ ChatFight Rankings</h1><div class="sub">Live global activity, users and groups</div></header><main class="wrap"><section id="stats" class="stats"></section><div class="tabs"><button class="active" data-mode="today">Today</button><button data-mode="weekly">Weekly</button><button data-mode="total">All Time</button></div><section class="grid"><div class="card"><h2>🏆 Top Users</h2><div id="users">Loading...</div></div><div class="card"><h2>👥 Top Groups</h2><div id="groups">Loading...</div></div></section></main><script>let mode='today';const fmt=n=>Number(n||0).toLocaleString();async function load(){let d=await fetch('/api/dashboard?mode='+mode).then(r=>r.json());stats.innerHTML=[['👥 Total Users',d.stats.users],['💬 Total Messages',d.stats.messages],['🏘️ Groups',d.stats.groups]].map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><div class="num">'+fmt(x[1])+'</div></div>').join('');users.innerHTML='<ol>'+d.users.map((x,i)=>'<li class="row"><span><span class="name">'+esc(x.displayName||x.userName||'Unknown')+'</span><div class="muted">Active in '+fmt(x.groupCount)+' group(s)</div></span><b>'+fmt(x.value)+'</b></li>').join('')+'</ol>';groups.innerHTML='<ol>'+d.groups.map(x=>'<li class="row"><span><span class="name">'+esc(x.groupName||'Unknown Group')+'</span><div class="muted">Tracked users: '+fmt(x.activeUsers)+(x.memberCount?' • Members: '+fmt(x.memberCount):'')+'</div></span><b>'+fmt(x.value)+'</b></li>').join('')+'</ol>'}function esc(s){return String(s).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))}document.querySelectorAll('button').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));load()});load();setInterval(load,30000);</script></body></html>`;
}

export function createHealthServer(getDb) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, { status: 'ok', service: 'chatfight' });
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(pageHtml()); }
      if (req.method === 'GET' && url.pathname === '/api/dashboard') {
        const db = await getDb(); const users = db.collection('group_users'); const groupStats = db.collection('group_stats');
        const mode = ['today','weekly','total'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : 'today';
        const {field, match} = modeFields(mode);
        const [userRows, groupRows, userCount, messageAgg, groupCount] = await Promise.all([
          users.aggregate([{ $match: match },{ $group:{_id:'$userId',displayName:{$last:'$displayName'},userName:{$last:'$userName'},value:{$sum:field},groupCount:{$sum:1}}},{ $sort:{value:-1}},{ $limit:100}]).toArray(),
          users.aggregate([{ $match: match },{ $group:{_id:'$groupId',groupName:{$last:'$groupName'},value:{$sum:field},activeUsers:{$sum:1}}},{ $sort:{value:-1}},{ $limit:100}]).toArray(),
          users.aggregate([{ $group:{_id:'$userId'}},{ $count:'n'}]).toArray(),
          users.aggregate([{ $group:{_id:null,n:{$sum:'$messageCount'}} }]).toArray(),
          users.aggregate([{ $group:{_id:'$groupId'}},{ $count:'n'}]).toArray(),
        ]);
        const statsDocs = await groupStats.find({ groupId: { $in: groupRows.map(x=>x._id) } }).toArray(); const members = new Map(statsDocs.map(x=>[x.groupId,x.memberCount]));
        return json(res,{mode,stats:{users:userCount[0]?.n||0,messages:messageAgg[0]?.n||0,groups:groupCount[0]?.n||0},users:userRows.map(x=>({...x,userId:x._id})),groups:groupRows.map(x=>({...x,groupId:x._id,memberCount:members.get(x._id)||null}))});
      }
      res.writeHead(404); res.end('Not found');
    } catch (e) { console.error('[Web]',e); json(res,{error:'Server error'},500); }
  });
}
