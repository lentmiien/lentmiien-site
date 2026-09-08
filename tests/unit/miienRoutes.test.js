const express = require('express');
const path = require('path');
const { createMiienRouter } = require('../../routes/miien');
const { MiienError } = require('../../services/miienChatService');
const id = 'a'.repeat(24);
const token = 'A'.repeat(43);
let server, origin, service, asr, speech, logger, roleModel;
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
  app.use('/chat5/miien',createMiienRouter({service,asr,speech,logger,roleModel}));
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
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
  const r=await request(`/${id}/transcribe`,{method:'POST',headers:{'Content-Type':'audio/wav','X-CSRF-Token':token},body:Buffer.alloc(100)});
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
  const r=await request(`/${id}/transcribe`,{method:'POST',headers:{'Content-Type':'audio/wav','X-CSRF-Token':token},body:b});
  expect(r.status).toBe(200);expect(await r.json()).toEqual({text:'Hello from the microphone'});
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
