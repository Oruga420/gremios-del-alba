import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalSpeech } from '../src/voice/local-speech.js';
class Recorder { static latest;static isTypeSupported(){return true;}constructor(){Recorder.latest=this;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3])],{type:'audio/webm'})});this.onstop?.();} }
class Audio { async resume(){}async close(){this.closed=true;}createMediaStreamSource(){return {connect(){},disconnect(){}};}createAnalyser(){return {fftSize:1024,getFloatTimeDomainData(samples){samples.fill(.1);},disconnect(){}};} }
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('local capture needs trusted click; denial releases lifecycle without auto-restart',async()=>{
  const statuses=[];let micCalls=0;const speech=createLocalSpeech({Recorder,Audio,getBinding:()=>({world:1}),mediaDevices:{async getUserMedia(){micCalls++;throw new DOMException('Denied','NotAllowedError');}},fetcher:async()=>Response.json({csrf:'test'}),onTranscript(){assert.fail('No transcript');},onStatus:s=>statuses.push(s)});assert.equal(await speech.start({isTrusted:false}),false);assert.equal(micCalls,0);assert.equal(await speech.start({isTrusted:true}),false);assert.equal(micCalls,1);assert.equal(speech.active,false);assert.equal(statuses.at(-1).state,'denied');speech.destroy();
});
test('closing during a permission request stops late acquired microphone tracks',async()=>{
  let resolveMic,stopped=0;const speech=createLocalSpeech({Recorder,Audio,getBinding:()=>({world:1}),mediaDevices:{getUserMedia:()=>new Promise(resolve=>resolveMic=resolve)},fetcher:async()=>Response.json({csrf:'test'}),onTranscript(){assert.fail('Late transcript');},onStatus(){}});const started=speech.start({isTrusted:true});await sleep(5);speech.stop('closed');resolveMic({getTracks:()=>[{stop(){stopped++;}}]});assert.equal(await started,false);assert.equal(stopped,1);assert.equal(speech.active,false);
});
test('actual recorder adapter posts audio and stale world/session/proposal callbacks never deliver',async()=>{
  let binding={worldGeneration:1,sessionEpoch:1,proposalId:'first'},resolveAudio,stopped=0,transcripts=0;const statuses=[];const speech=createLocalSpeech({Recorder,Audio,getBinding:()=>({...binding}),mediaDevices:{async getUserMedia(){return {getTracks:()=>[{stop(){stopped++;}}]};}},fetcher:async(url,options)=>url==='/api/session'?Response.json({csrf:'test'}):new Promise(resolve=>{assert.ok(options.body instanceof Blob);resolveAudio=()=>resolve(Response.json({ok:true,transcript:'alto',engine:'vosk'}));}),onTranscript(){transcripts++;},onStatus:s=>statuses.push(s)});
  await speech.start({isTrusted:true});await sleep(65);Recorder.latest.stop();await sleep(5);binding={worldGeneration:2,sessionEpoch:2,proposalId:null};resolveAudio();await sleep(5);assert.equal(transcripts,0);assert.equal(stopped,1);assert.equal(speech.active,false);assert.equal(statuses.at(-1).state,'stale-world');speech.destroy();
});
