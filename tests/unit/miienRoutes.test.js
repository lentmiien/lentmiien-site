const express = require('express');
const path = require('path');
const { createMiienRouter } = require('../../routes/miien');
const { MiienTranscriptionJobs } = require('../../utils/miienTranscriptionJobs');
const { MiienError } = require('../../services/miienChatService');
const id = 'a'.repeat(24);
const token = 'A'.repeat(43);
let server, origin, service, asr, speech, logger, roleModel, transcription;
const principal = { _id:'b'.repeat(24), name:'owner', type_user:'admin' };
beforeEach(async () => {
  service = { models:jest.fn().mockResolvedValue([{id:'model',name:'Model',provider:'OpenAI'}]), list:jest.fn().mockResolvedValue([]),
    owned:jest.fn().mockResolvedValue({_id:id,title:'Hi',metadata:{},messages:[]}),compatible:jest.fn().mockResolvedValue(),
    create:jest.fn().mockResolvedValue({_id:id}),update:jest.fn().mockResolvedValue(),
    snapshot:jest.fn().mockResolvedValue({messages:[],pending:false}),send:jest.fn().mockResolvedValue({accepted:true}) };
  asr={transcribeBuffer:jest.fn().mockResolvedValue({data:{text:'Hello from the microphone'}})};
  speech={submit:jest.fn().mockResolvedValue({id:'job',status:'preparing'}),get:jest.fn().mockResolvedValue({status:'ready'})};
  logger={warning:jest.fn(),error:jest.fn()};
  roleModel={findOne:jest.fn().mockResolvedValue(null)};
  const app=express();app.set('views',path.join(__dirname,'../../views'));app.set('view engine','pug');
  app.use((req,res,next)=>{
    req.user=req.get('x-anonymous')?null:{...principal,type_user:req.get('x-role')||'admin'};
    req.isAuthenticated=()=>Boolean(req.user);req.session={csrfToken:token};next();
  });
  transcription = new MiienTranscriptionJobs({ chat: service, asr, logger, authorize: async () => principal,
    slots: { init: async () => {}, create: async () => {}, deleteOne: async () => {} } });
  app.use('/chat5/miien',createMiienRouter({service,transcription,speech,logger,roleModel}));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
});
afterEach(async()=>{for (const job of transcription.jobs.values()) clearTimeout(job.timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
function request(url='',options={}) {return fetch(origin+'/chat5/miien'+url,{...options,headers:{Accept:'application/json',...options.headers}});}
function post(url,body={},headers={}) {return request(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token,...headers},body:JSON.stringify(body)});}
test('anonymous is denied before catalog or storage access',async()=>{
  const response=await request('',{headers:{'x-anonymous':'true'}});expect(response.status).toBe(401);expect(service.models).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toContain('no-store');
});
test.each(['family','user','unknown'])('role %s has no implicit access',async role=>{
  const response=await request('',{headers:{'x-role':role}});expect(response.status).toBe(403);expect(service.models).not.toHaveBeenCalled();
});
test('explicit per-user read grant allows access but does not imply writes or audio',async()=>{
  roleModel.findOne.mockImplementation(async query=>query.type==='user'?{permissions:['chat.conversation.read']}:null);
  expect((await request('',{headers:{'x-role':'user'}})).status).toBe(200);
  expect((await post('',{}, {'x-role':'user'})).status).toBe(403);
  expect((await post(`/${id}/transcribe`,{}, {'x-role':'user'})).status).toBe(403);
  expect(service.create).not.toHaveBeenCalled();expect(asr.transcribeBuffer).not.toHaveBeenCalled();
});
test('admin can read private page with real generated art and no analytics',async()=>{
  const r=await request('');const html=await r.text();expect(r.status).toBe(200);
  expect(html).toContain('/i/miien/neutral.webp');expect(html).not.toMatch(/googletagmanager|cdn\./);
  expect(r.headers.get('referrer-policy')).toBe('no-referrer');
});
test.each(['', `/${id}/settings`])('start/model page %s directs preferences to the room and preserves settings fields', async url => {
  const response = await request(url);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain('Phase 2 foundation');
  expect(html).toContain('Voice, captions and motion are set in room Settings');
  expect(html).not.toMatch(/id="speech-(enabled|voice|status)"|miien_voice.js|Phase 1/);
  for (const field of ['title', 'model', 'reasoning', 'verbosity', 'maxMessages', 'context', '_csrf']) {
    expect(html).toContain(`name="${field}"`);
  }
  if (url) {
    expect(html).toContain(`action="/chat5/miien/${id}/settings"`);
    expect(html).toContain(`href="/chat5/miien/${id}">Return to room</a>`);
  } else {
    expect(html).toContain('Start or resume a conversation to open room Settings.');
  }
});
test('model/context form saves through the existing CSRF-protected conversation update', async () => {
  const body = { title: 'Updated', model: 'model', reasoning: 'low', verbosity: 'medium', maxMessages: '12', context: 'Synthetic context' };
  const url = `/${id}/settings`;
  expect((await post(url, body, { 'X-CSRF-Token': '' })).status).toBe(403);
  expect(service.update).not.toHaveBeenCalled();
  const response = await request(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, _csrf: token }) });
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(`/chat5/miien/${id}`);
  expect(service.update).toHaveBeenCalledWith(principal, id, { ...body, _csrf: token });
});
test.each([['missing',''],['invalid','B'.repeat(43)]])('rejects %s CSRF before mutation',async(_,csrf)=>{
  expect((await post('',{}, {'X-CSRF-Token':csrf})).status).toBe(403);expect(service.create).not.toHaveBeenCalled();
});
test('rejects hostile Origin even with valid token',async()=>{
  expect((await post('',{}, {Origin:'https://untrusted.invalid'})).status).toBe(403);expect(service.create).not.toHaveBeenCalled();
});
test('valid mutation forwards principal and redirects only to a local room',async()=>{
  const response=await request('',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','X-CSRF-Token':token,Origin:origin},body:'{}'});
  expect(response.status).toBe(303);expect(response.headers.get('location')).toBe(`/chat5/miien/${id}`);
  expect(service.create).toHaveBeenCalledWith(principal,{});
});
test('GET messages cannot send and state always uses current principal',async()=>{
  expect((await request(`/${id}/messages`)).status).toBe(404);expect(service.send).not.toHaveBeenCalled();
  expect((await request(`/${id}/state`)).status).toBe(200);expect(service.snapshot).toHaveBeenCalledWith(principal,id);
});
test.each([`/${id}`,`/${id}/settings`,`/${id}/transcribe`])('foreign object %s fails before content/ASR',async url=>{
  service.owned.mockRejectedValue(new MiienError(404,'Conversation not found.'));
  const response=url.endsWith('transcribe')?await post(url):await request(url);
  expect(response.status).toBe(404);expect(asr.transcribeBuffer).not.toHaveBeenCalled();
});
test('oversized body rejected before service work',async()=>{
  const response=await post(`/${id}/messages`,{text:'a'.repeat(20000)});expect(response.status).toBe(413);expect(service.send).not.toHaveBeenCalled();
});
test('malformed WAV is rejected, not passed to ASR',async()=>{
  const job = await (await post(`/${id}/transcribe`)).json();
  const r=await request(`/${id}/transcribe/${job.id}/audio`,{method:'POST',headers:{'Content-Type':'audio/wav','X-CSRF-Token':token},body:Buffer.alloc(100)});
  expect(r.status).toBe(400);expect(asr.transcribeBuffer).not.toHaveBeenCalled();
});
test('provider errors are generic and logged without private error payload',async()=>{
  service.send.mockRejectedValue(new Error('secret-prompt-and-token'));
  const r=await post(`/${id}/messages`);expect(r.status).toBe(503);expect(await r.text()).not.toContain('secret-prompt-and-token');
  expect(logger.error).toHaveBeenCalledWith(expect.any(String),{category:'chat5_miien',metadata:{operation:'/:id/messages',errorName:'Error'}});
});
test('room renders malicious titles as inert text and has no inline script',async()=>{
  service.owned.mockResolvedValue({_id:id,title:'</script><img src=x onerror=alert(1)>',metadata:{}});
  const r=await request(`/${id}`);const html=await r.text();
  expect(html).toContain('&lt;img');expect(html).not.toContain('<img src=x');expect(html).not.toContain('<script>');
});
test('valid microphone WAV uses the existing private ASR contract and returns editable text',async()=>{
  const b=Buffer.alloc(364);b.write('RIFF');b.writeUInt32LE(356,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);
  b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(320,40);
  const job = await (await post(`/${id}/transcribe`)).json();
  const r=await request(`/${id}/transcribe/${job.id}/audio`,{method:'POST',headers:{'Content-Type':'audio/wav','X-CSRF-Token':token},body:b});
  expect(r.status).toBe(202);
  expect(await (await request(`/${id}/transcribe/${job.id}`)).json()).toMatchObject({status:'ready',text:'Hello from the microphone'});
  expect(asr.transcribeBuffer).toHaveBeenCalledWith(expect.objectContaining({buffer:b,privateRequest:true,mimetype:'audio/wav',options:{model:'whisper-api',language:'auto'}}));
  expect(service.send).not.toHaveBeenCalled();
});

test('speech submission requires its own capability and CSRF/Origin', async () => {
  roleModel.findOne.mockResolvedValue({ permissions: ['chat.conversation.read', 'chat.conversation.write', 'chat.audio.transcribe'] });
  expect((await post(`/${id}/speech`, {}, { 'x-role': 'user' })).status).toBe(403);
  expect((await post(`/${id}/speech`, {}, { 'X-CSRF-Token': '' })).status).toBe(403);
  expect((await post(`/${id}/speech`, {}, { Origin: 'https://evil.invalid' })).status).toBe(403);
  expect(speech.submit).not.toHaveBeenCalled();
  expect((await post(`/${id}/speech`, { messageId: id, voiceId: 'anny_en' })).status).toBe(202);
  expect(speech.submit).toHaveBeenCalledWith(principal, id, { messageId: id, voiceId: 'anny_en' });
});
test('private speech reads reauthorize capabilities and deliver nosniff WAV', async () => {
  expect((await request(`/${id}/speech/job`, { headers: { 'x-anonymous': '1' } })).status).toBe(401);
  expect((await request(`/${id}/speech/job/audio`, { headers: { 'x-role': 'user' } })).status).toBe(403);
  expect(speech.get).not.toHaveBeenCalled();
  speech.get.mockResolvedValue(Buffer.from('fixture'));
  const response = await request(`/${id}/speech/job/audio`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('audio/wav');
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(speech.get).toHaveBeenCalledWith(principal, id, 'job', true);
  speech.get.mockRejectedValue(new MiienError(404, 'Conversation not found.'));
  expect((await request(`/${id}/speech/job/audio`)).status).toBe(404);
});
test('speech cannot mutate through GET and submission rate limit bounds jobs', async () => {
  expect((await request(`/${id}/speech`)).status).toBe(404);
  for (let n = 0; n < 4; n++) expect((await post(`/${id}/speech`)).status).toBe(202);
  expect((await post(`/${id}/speech`)).status).toBe(429);
  expect(speech.submit).toHaveBeenCalledTimes(4);
});

test('fresh replay status preserves safe backend attribution and is never cacheable', async () => {
  speech.get.mockResolvedValue({ id: 'job', messageId: id, voiceId: 'anny_en', backendId: 'omni_anny_en', status: 'ready' });
  const r = await request(`/${id}/speech/job`);
  expect(r.headers.get('cache-control')).toContain('no-store');
  expect(await r.json()).toMatchObject({ voiceId: 'anny_en', backendId: 'omni_anny_en' });
  expect(speech.get).toHaveBeenCalledWith(principal, id, 'job');
});

test('admission checks require fresh session and synthesis capability before service access', async () => {
  speech.admission = jest.fn().mockResolvedValue({ state: 'occupied' });
  const url = `/${id}/speech-admission/${id}`;
  expect((await request(url, { headers: { 'x-anonymous': '1' } })).status).toBe(401);
  roleModel.findOne.mockResolvedValue({ permissions: ['chat.conversation.read'] });
  for (const role of ['user', 'family']) expect((await request(url, { headers: { 'x-role': role } })).status).toBe(403);
  expect(speech.admission).not.toHaveBeenCalled();
  roleModel.findOne.mockResolvedValue({ permissions: ['chat.conversation.read', 'chat.audio.synthesize'] });
  const result = await request(url, { headers: { 'x-role': 'user' } });
  expect(result.status).toBe(200); expect(await result.json()).toEqual({ state: 'occupied' });
  expect(result.headers.get('cache-control')).toContain('no-store');
  expect(result.headers.get('x-content-type-options')).toBe('nosniff');
  expect(speech.admission).toHaveBeenCalledWith({ ...principal, type_user: 'user' }, id, id);
  roleModel.findOne.mockResolvedValue({ permissions: ['chat.conversation.read'] });
  expect((await request(url, { headers: { 'x-role': 'user' } })).status).toBe(403);
  expect(speech.admission).toHaveBeenCalledTimes(1);
  expect(speech.submit).not.toHaveBeenCalled();
});
test('admission rejects foreign/missing child and logs sanitized operational read failure', async () => {
  speech.admission = jest.fn().mockRejectedValue(new MiienError(404, 'Not found.'));
  const url = `/${id}/speech-admission/${id}`;
  expect((await request(url)).status).toBe(404);
  speech.admission.mockRejectedValue(new Error('private database payload'));
  const result = await request(url);
  expect(result.status).toBe(503); expect(await result.text()).not.toContain('private database payload');
  expect(logger.error).toHaveBeenCalled(); expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private database payload');
});
test('only occupied service rejection carries safe deferral code; admission GET does not consume speech POST budget', async () => {
  const { MiienSpeechOccupiedError } = require('../../services/miienSpeechService');
  speech.admission = jest.fn().mockResolvedValue({ state: 'occupied' });
  for (let i = 0; i < 12; i++) expect((await request(`/${id}/speech-admission/${id}`)).status).toBe(200);
  speech.submit.mockRejectedValueOnce(new MiienSpeechOccupiedError());
  const busy = await post(`/${id}/speech`);
  expect(busy.status).toBe(429); expect(await busy.json()).toMatchObject({ code: 'speech_admission_occupied' });
  speech.submit.mockRejectedValueOnce(new MiienError(429, 'Storage full'));
  expect(await (await post(`/${id}/speech`)).json()).toEqual({ error: 'Storage full' });
  for (let i = 0; i < 2; i++) expect((await post(`/${id}/speech`)).status).toBe(202);
  const limited = await post(`/${id}/speech`);
  expect(limited.status).toBe(429); expect(await limited.text()).not.toContain('speech_admission_occupied');
  expect(speech.submit).toHaveBeenCalledTimes(4);
});

test('ASR reservation, upload, status and discard all require capability/session; mutations require CSRF and same origin', async () => {
  const job = await (await post(`/${id}/transcribe`)).json();
  const urls = [`/${id}/transcribe`, `/${id}/transcribe/${job.id}/audio`, `/${id}/transcribe/${job.id}`];
  roleModel.findOne.mockResolvedValue({ permissions: ['chat.conversation.read', 'chat.conversation.write'] });
  for (const url of urls) {
    expect((await post(url, {}, { 'x-anonymous': '1' })).status).toBe(401);
    expect((await post(url, {}, { 'x-role': 'user' })).status).toBe(403);
    expect((await post(url, {}, { 'X-CSRF-Token': '' })).status).toBe(403);
    expect((await post(url, {}, { Origin: 'https://evil.invalid' })).status).toBe(403);
  }
  expect((await request(urls[2], { headers: { 'x-anonymous': '1' } })).status).toBe(401);
  expect((await request(urls[2], { headers: { 'x-role': 'user' } })).status).toBe(403);
  expect(asr.transcribeBuffer).not.toHaveBeenCalled();
});
test('ASR polling is read-only and private; duplicate reservation and failed ownership cannot bypass capacity', async () => {
  const job = await (await post(`/${id}/transcribe`)).json();
  expect((await post(`/${id}/transcribe`)).status).toBe(429);
  for (let i = 0; i < 15; i++) {
    const result = await request(`/${id}/transcribe/${job.id}`);
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toContain('private, no-store');
    expect(await result.json()).toMatchObject({ status: 'awaiting_upload' });
  }
  expect((await request(`/${id}/transcribe/${job.id}/audio`)).status).toBe(404);
  expect(asr.transcribeBuffer).not.toHaveBeenCalled();
  service.owned.mockRejectedValue(new MiienError(404, 'Conversation not found.'));
  expect((await request(`/${id}/transcribe/${job.id}`)).status).toBe(404);
  expect((await post(`/${id}/transcribe/${job.id}`, { action: 'cancel' })).status).toBe(404);
});
test('ASR upload size/type/content encoding and fields are bounded before dispatch', async () => {
  expect((await post(`/${id}/transcribe`, { owner: 'other' })).status).toBe(400);
  for (const [body, contentType, encoding, expected] of [
    [Buffer.alloc(2000000), 'audio/wav', null, 413],
    [Buffer.alloc(364), 'application/octet-stream', null, 400],
    [Buffer.alloc(364), 'audio/wav', 'gzip', 415],
  ]) {
    const job = await (await post(`/${id}/transcribe`)).json();
    const result = await request(`/${id}/transcribe/${job.id}/audio`, { method: 'POST', headers: {
      'X-CSRF-Token': token, 'Content-Type': contentType, ...(encoding ? { 'Content-Encoding': encoding } : {}),
    }, body });
    expect(result.status).toBe(expected);
  }
  expect(asr.transcribeBuffer).not.toHaveBeenCalled();
});
