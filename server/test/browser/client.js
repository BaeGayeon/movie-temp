import {CMD} from '/extension/shared/cmd.js';
const params=new URLSearchParams(location.search),role=params.get('role'),video=document.querySelector('video');
document.querySelector('#role').textContent=role==='host'?'방장':'참가자';
const userId=role+'-browser-test-0001',secret=('test-secret-'+role).padEnd(32,'x');
const ws=new WebSocket(`ws://${location.host}/bridge`),listeners=[];
const channel=new BroadcastChannel('bmt-rate-test');let rateEvents=0;
channel.onmessage=e=>{if(role==='guest'&&e.data?.command==='reloadGuest')location.reload();};
let state=null,resolveReady;const ready=new Promise(r=>resolveReady=r);
const emit=(cmd,extra={})=>listeners.forEach(fn=>fn({cmd,state:structuredClone(state),...extra},{},()=>{}));
function mirror(m){state.video={playing:['seek','rate'].includes(m.action)?state.video.playing:m.action==='play'||m.action==='sync',time:m.time,updatedAt:m.serverAt??Date.now(),rate:m.rate??state.video.rate??1};}
ws.onopen=()=>ws.send(JSON.stringify(role==='host'?{type:'create_room',userId,secret}:{type:'join_room',userId,secret,roomCode:params.get('code')}));
ws.onmessage=e=>{
 const m=JSON.parse(e.data);
 if(m.type==='room_state'){
  state={...m,userId,connection:'connected',serverOffset:0,roomPage:location.origin+location.pathname,waitingIds:[],adIds:[]};
  resolveReady();if(role==='host')parent.postMessage({type:'room',code:m.roomCode},location.origin);
 }else if(m.type==='video'){mirror(m);emit(CMD.REMOTE_VIDEO,{msg:m});}
 else if(m.type==='countdown'){state.video={playing:true,time:m.time,updatedAt:m.startAt,rate:m.rate??state.video.rate};emit(CMD.COUNTDOWN);}
 else if(m.type==='buffer_state'){state.video=m.video;state.waitingIds=m.waitingIds;state.adIds=m.adIds;emit(CMD.BUFFER);}
 else if(m.type==='participant_joined'){state.participants.push(m.user);}
 else if(m.type==='error'){document.querySelector('#status').textContent='ERROR '+JSON.stringify(m);}
};
const send=m=>ws.send(JSON.stringify(m));
const fakeChrome={i18n:{getUILanguage:()=> 'ko'},storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){}}},runtime:{getURL:p=>location.origin+'/extension/'+p,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async m=>{
 await ready;
 if(m.cmd===CMD.REGISTER)return{state:structuredClone(state),chat:[]};
 if(m.cmd===CMD.VIDEO_EVENT){if(m.action==='rate')rateEvents++;mirror({...m,serverAt:Date.now()});send({type:'video',action:m.action,time:m.time,rate:m.rate,sentAt:m.sentAt});}
 if(m.cmd===CMD.SYNC_REPORT)send({type:'sync_report',time:m.time,playing:m.playing,sentAt:m.sentAt});
 if(m.cmd===CMD.BUFFERING)send({type:'buffering',isBuffering:m.isBuffering,time:m.time,reason:m.reason});
 return{};
}}};
Object.defineProperty(window,'chrome',{value:fakeChrome,configurable:true});
await ready;
if(video.readyState===0)await new Promise(r=>video.addEventListener('loadedmetadata',r,{once:true}));
const script=document.createElement('script');script.src='/extension/content/main.js';document.body.append(script);
document.querySelector('#play').onclick=()=>video.play();document.querySelector('#pause').onclick=()=>video.pause();
document.querySelector('#rate').onchange=e=>video.playbackRate=Number(e.target.value);
document.querySelector('#seek').onclick=()=>video.currentTime=60;
window.addEventListener('message',e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.type==='countdown')send({type:'countdown_start',seconds:3});});
setInterval(()=>{channel.postMessage({player:role,rate:video.playbackRate,time:video.currentTime,paused:video.paused,rateEvents,wall:Date.now()});document.querySelector('#status').textContent=`${role} | 방 ${state.roomCode} | 실제 ${video.playbackRate.toFixed(3)}배속 | ${video.currentTime.toFixed(2)}초 | ${video.paused?'정지':'재생'} | 배속 전송 ${rateEvents}회`;},250);
