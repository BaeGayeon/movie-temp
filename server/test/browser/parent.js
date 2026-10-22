const host=document.querySelector('#host');
const channel=new BroadcastChannel('bmt-rate-test');const metrics={};
window.addEventListener('message',e=>{
 if(e.source!==host.contentWindow||e.data?.type!=='room')return;
 document.querySelector('#room').textContent=`방 코드: ${e.data.code}`;
 document.querySelector('#join').href=`/test/client.html?role=guest&code=${e.data.code}`;
});
document.querySelector('#late').onclick=()=>channel.postMessage({command:'reloadGuest'});
document.querySelector('#countdown').onclick=()=>host.contentWindow.postMessage({type:'countdown'},location.origin);
channel.onmessage=e=>{if(!e.data.player)return;metrics[e.data.player]=e.data;document.querySelector('#metrics').textContent=JSON.stringify(metrics,null,2);};
