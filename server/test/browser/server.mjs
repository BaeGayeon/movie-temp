import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import WebSocket,{WebSocketServer}from'ws';import {createServer}from'../../src/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const app=createServer({port:8898,host:'127.0.0.1'});await app.listen();
// Deterministic 10-minute silent PCM fixture, generated in memory (no binary asset).
const pcmBytes=8000*2*600,silence=Buffer.alloc(44+pcmBytes);
silence.write('RIFF');silence.writeUInt32LE(36+pcmBytes,4);silence.write('WAVEfmt ',8);silence.writeUInt32LE(16,16);silence.writeUInt16LE(1,20);silence.writeUInt16LE(1,22);silence.writeUInt32LE(8000,24);silence.writeUInt32LE(16000,28);silence.writeUInt16LE(2,32);silence.writeUInt16LE(16,34);silence.write('data',36);silence.writeUInt32LE(pcmBytes,40);
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=pathname.startsWith('/extension/')?path.join(root,pathname):path.join(root,'server/test/browser',pathname.replace(/^\/test\//,''));
 if(!file.startsWith(root+'/')||(pathname!=='/test/silence.wav'&&(!fs.existsSync(file)||!fs.statSync(file).isFile()))){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.wav')?'audio/wav':'text/html');
 const data=pathname==='/test/silence.wav'?silence:fs.readFileSync(file);
 res.setHeader('Accept-Ranges','bytes');
 const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
 if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||data.length-1),data.length-1);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});return res.end(data.subarray(start,end+1));}
 res.setHeader('Content-Length',data.length);res.end(data);
});
const bridge=new WebSocketServer({server,path:'/bridge'});
bridge.on('connection',client=>{
 const upstream=new WebSocket('ws://127.0.0.1:8898');const queue=[];
 client.on('message',data=>upstream.readyState===WebSocket.OPEN?upstream.send(data.toString()):queue.push(data));
 upstream.on('open',()=>queue.forEach(data=>upstream.send(data.toString())));
 upstream.on('message',data=>client.readyState===WebSocket.OPEN&&client.send(data.toString()));
 client.on('close',()=>upstream.close());upstream.on('close',()=>client.close());
});
server.listen(8899,'127.0.0.1',()=>console.log('Browser fixture http://127.0.0.1:8899/test/index.html; real room server :8898'));
process.on('SIGINT',async()=>{bridge.clients.forEach(c=>c.terminate());bridge.close();server.close();await app.close();process.exit(0);});
