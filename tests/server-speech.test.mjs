import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server.mjs';
import { createLocalSpeechService, SPEECH_LIMITS } from '../scripts/local-speech-service.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function fixture(service) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'guild-speech-'));await writeFile(path.join(directory,'index.html'),'<title>test</title>');
  const app=await createGameServer({root:directory,speechService:service||{status:()=>({ready:true}),transcribe:async()=>({transcript:'luna recoge madera'}),close:async()=>{}}});const address=await app.listen(0);
  const response=await fetch(address.url+'/api/session'),session=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  const request=(body=Buffer.from('RIFFtestWAVE'),headers={})=>fetch(address.url+'/api/speech',{method:'POST',headers:{Origin:address.url,Cookie:cookie,'X-Guild-CSRF':session.csrf,'Content-Type':'audio/wav',...headers},body});
  return {app,directory,...address,session,cookie,request,async cleanup(){await app.close();await rm(directory,{recursive:true,force:true});}};
}
test('speech HTTP requires session/exact Origin/CSRF and enforces MIME/body limits',async()=>{
  const h=await fixture();try{assert.equal((await fetch(h.url+'/api/speech',{method:'POST',headers:{Origin:h.url,'Content-Type':'audio/wav'},body:'x'})).status,401);assert.equal((await h.request(undefined,{'X-Guild-CSRF':'bad'})).status,403);assert.equal((await h.request(undefined,{Origin:'https://evil.example'})).status,403);assert.equal((await h.request(undefined,{'Content-Type':'text/plain'})).status,415);assert.equal((await h.request(Buffer.alloc(SPEECH_LIMITS.bytes+1))).status,413);const accepted=await h.request();assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'no-store');assert.equal((await accepted.json()).transcript,'luna recoge madera');}finally{await h.cleanup();}
});
test('speech endpoint bounds concurrency and preserves the rate limit across restart',async()=>{
  let release,entered;const enteredPromise=new Promise(resolve=>entered=resolve);const h=await fixture({status:()=>({ready:true}),transcribe:async()=>{entered();return new Promise(resolve=>release=()=>resolve({transcript:'alto'}));},close:async()=>{}});
  try{const first=h.request();await enteredPromise;assert.equal((await h.request()).status,429);release();assert.equal((await first).status,200);await h.app.close();
    const service={status:()=>({ready:true}),transcribe:async()=>({transcript:'alto'}),close:async()=>{}};const app=await createGameServer({root:h.directory,speechService:service});const address=await app.listen(0);
    try{for(let i=0;i<SPEECH_LIMITS.perSession-1;i++){const r=await fetch(address.url+'/api/speech',{method:'POST',headers:{Origin:address.url,Cookie:h.cookie,'X-Guild-CSRF':h.session.csrf,'Content-Type':'audio/wav'},body:'RIFFtestWAVE'});assert.equal(r.status,200);}const r=await fetch(address.url+'/api/speech',{method:'POST',headers:{Origin:address.url,Cookie:h.cookie,'X-Guild-CSRF':h.session.csrf,'Content-Type':'audio/wav'},body:'RIFFtestWAVE'});assert.equal(r.status,429);assert.equal((await r.json()).code,'SPEECH_RATE_LIMIT');}finally{await app.close();}
  }finally{await h.cleanup();}
});
test('disconnect aborts actual in-flight speech work and decoder errors stay sanitized',async()=>{
  let entered,aborted;const enteredPromise=new Promise(resolve=>entered=resolve),abortedPromise=new Promise(resolve=>aborted=resolve);const h=await fixture({status:()=>({ready:true}),transcribe:async(_bytes,_mime,{signal})=>{entered();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(Object.assign(new Error('SECRET_CANARY'),{code:'ABORTED'}));},{once:true}));},close:async()=>{}});
  try{const req=http.request(h.url+'/api/speech',{method:'POST',headers:{Origin:h.url,Cookie:h.cookie,'X-Guild-CSRF':h.session.csrf,'Content-Type':'audio/wav'}},()=>{});req.on('error',()=>{});req.end('RIFFtestWAVE');await enteredPromise;req.destroy();await abortedPromise;}finally{await h.cleanup();}
  const failed=await fixture({status:()=>({ready:true}),transcribe:async()=>{throw new Error('SECRET_CANARY');},close:async()=>{}});try{const response=await failed.request();assert.equal(response.status,422);assert.equal((await response.text()).includes('SECRET_CANARY'),false);}finally{await failed.cleanup();}
});
test('local speech remains optional when no runtime is configured',async()=>{
  const service=createLocalSpeechService(root, {});
  try { await assert.rejects(()=>service.start(),{code:'LOCAL_ASR_UNAVAILABLE'});assert.equal(service.status().ready,false);assert.equal(service.status().local,true);await assert.rejects(()=>service.transcribe(Buffer.from('#EXTM3U\nfile:///secret'),'audio/webm'),{code:'AUDIO_FORMAT_REJECTED'}); }
  finally { await service.close(); }
});
const realSpeechEnabled = ['GUILD_TEST_VOSK_WAV','GUILD_VOSK_MODEL_PATH','GUILD_PYTHON_PATH','GUILD_FFMPEG_PATH'].every(name=>process.env[name]);
test('real offline Spanish model/decoder recognizes supplied synthetic WAV and removes only project temp files',{skip:!realSpeechEnabled},async()=>{
  const service=createLocalSpeechService(root);try{await service.start();assert.equal(service.status().ready,true);const result=await service.transcribe(await readFile(process.env.GUILD_TEST_VOSK_WAV),'audio/wav');assert.equal(result.transcript,'luna recoge madera');assert.equal(result.cloud,false);assert.ok(result.durationSeconds<8);await assert.rejects(()=>service.transcribe(Buffer.from('#EXTM3U\nfile:///secret'),'audio/webm'),{code:'AUDIO_FORMAT_REJECTED'});
    const data=Buffer.alloc(44+32000*9);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);await assert.rejects(()=>service.transcribe(data,'audio/wav'),{code:'AUDIO_TOO_LONG'});assert.deepEqual((await readdir(path.join(root,'.local/speech/tmp'))).filter(name=>name.startsWith('utterance-')),[]);
  }finally{await service.close();}
});
