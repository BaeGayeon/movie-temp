import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the real content-script functions, including their ratechange guard.
const source=readFileSync(new URL('../../extension/content/main.js',import.meta.url),'utf8');
const rates=source.slice(source.indexOf('  let appliedRate ='),source.indexOf('  // 서버가 저장한 마지막 영상 상태'));
const apply=source.slice(source.indexOf('  function applyRoomVideo()'),source.indexOf('  function applyRemote('));
const drift=source.slice(source.indexOf('  function correctDrift()'),source.indexOf('  setInterval(correctDrift'));
function player(overrides={}){
 const env={video:{currentTime:120,playbackRate:2,paused:false},state:{roomCode:'ABCDEF',hostId:'host',userId:'guest',video:{rate:2,time:100,playing:true,updatedAt:0}},inAd:false,normalizing:false,remeasuring:false,startTimer:null,now:10000,events:[],...overrides};
 Object.assign(env,{active:()=>!!env.state?.roomCode,serverNow:()=>env.now,pos:()=>env.video.currentTime,canControl:()=>env.state.mode!=='host_only'||env.state.userId===env.state.hostId,onLocal:action=>env.events.push(action),seekTo:t=>env.video.currentTime=t,setPlaying:p=>env.video.paused=!p,clearTimeout:()=>{},setTimeout:()=>0});
 vm.createContext(env);vm.runInContext(rates+apply+drift,env);return env;
}
test('콘텐츠: 방 밖에서는 사용자가 선택한 2배속을 초기화하지 않는다',()=>{
 const p=player({state:null});p.correctDrift();assert.equal(p.video.playbackRate,2);
});
test('콘텐츠: 2배속 기준 타임라인과 늦은 입장 위치 계산',()=>{
 const p=player();p.correctDrift();assert.equal(p.video.playbackRate,2);
 p.video.currentTime=0;p.video.playbackRate=1;p.applyRoomVideo();
 assert.equal(p.video.currentTime,120);assert.equal(p.video.playbackRate,2);assert.equal(p.video.paused,false);
});
test('콘텐츠: 미세 보정은 2배속을 중심으로 하며 ratechange 를 재전송하지 않는다',()=>{
 const p=player();p.video.currentTime=120.6;p.correctDrift();
 assert.ok(p.video.playbackRate<2&&p.video.playbackRate>1.8);
 p.onRateChange();assert.equal(p.events.length,0);
 p.video.playbackRate=1.5;p.onRateChange();assert.deepEqual(p.events,['rate']);
});
test('콘텐츠: 방장 전용일 때 참가자의 배속 변경은 방 배속으로 복구한다',()=>{
 const p=player();p.state.mode='host_only';p.video.playbackRate=1.5;p.onRateChange();
 assert.equal(p.video.playbackRate,2);assert.equal(p.events.length,0);
});
test('콘텐츠: 일시정지와 방장 보정에서도 2배속을 보존한다',()=>{
 const p=player();p.video.paused=true;p.correctDrift();assert.equal(p.video.playbackRate,2);
 p.video.paused=false;p.state.userId='host';p.correctDrift();assert.equal(p.video.playbackRate,2);
});
