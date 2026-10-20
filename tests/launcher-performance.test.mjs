import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportPersonalDefinition, personalKey } from '../scripts/personal-voice.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('project launcher requests native tools and performance GPU without changing global settings', {skip:process.platform!=='win32'}, (context) => {
  let output;
  try { output=execFileSync('powershell.exe',['-NoProfile','-File',path.join(root,'start-webmcp.ps1'),'-VerifyOnly'],{encoding:'utf8',timeout:15000,windowsHide:true}); } catch (error) {
    if (String(error.stderr).includes('Google Chrome was not found.')) return context.skip('Optional Chrome installation is unavailable');
    throw error;
  }
  const value=JSON.parse(output);
  assert.ok(value.Arguments.includes('--force-high-performance-gpu'));
  assert.ok(value.Arguments.includes('--enable-features=WebMCP'));
  assert.equal(value.Profile,path.join(root,'.local','browser','webmcp'));
  assert.equal(value.GlobalPreferencesChanged,false);
  const starter=readFileSync(path.join(root,'start-game.ps1'),'utf8');
  assert.match(starter,/Start-Process -FilePath \$gameUrl/u);
});


test('server launcher loads optional local environment without requiring a memory runtime', () => {
  const starter=readFileSync(path.join(root,'start-game.ps1'),'utf8');
  assert.match(starter,/--env-file-if-exists=\.env/u);
  assert.doesNotMatch(starter,/memory\.py|wake-up/u);
  const chrome=readFileSync(path.join(root,'start-webmcp.ps1'),'utf8');
  assert.match(chrome,/LOCALAPPDATA/u);
  assert.match(chrome,/ProgramFiles\(x86\)/u);
});

test('voice export uses explicit environment settings and leaves provider defaults when omitted', async () => {
  const names=['ELEVENLABS_API_KEY','ELEVENLABS_VOICE_ID','ELEVENLABS_LLM'];
  const saved=names.map(name=>process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    await assert.rejects(personalKey(),/ELEVENLABS_API_KEY_REQUIRED/u);
    const defaults=await exportPersonalDefinition();
    assert.equal(Object.hasOwn(defaults.conversation_config.tts,'voice_id'),false);
    assert.equal(Object.hasOwn(defaults.conversation_config.agent.prompt,'llm'),false);
    process.env.ELEVENLABS_API_KEY=' configured-test-key ';
    process.env.ELEVENLABS_VOICE_ID=' configured-voice ';
    process.env.ELEVENLABS_LLM=' configured-model ';
    assert.equal(await personalKey(),'configured-test-key');
    const configured=await exportPersonalDefinition();
    assert.equal(configured.conversation_config.tts.voice_id,'configured-voice');
    assert.equal(configured.conversation_config.agent.prompt.llm,'configured-model');
    assert.equal(configured.conversation_config.agent.prompt.tools.length,36);
  } finally {
    names.forEach((name,index)=>{ if(saved[index]===undefined) delete process.env[name]; else process.env[name]=saved[index]; });
  }
});
