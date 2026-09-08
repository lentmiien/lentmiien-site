const fs = require('fs');
const vm = require('vm');
const pug = require('pug');
let JSDOM;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
const source = fs.readFileSync('public/js/miien.js', 'utf8');
const { MOODS, classifyMood } = require('../../utils/miienMood');
const voiceSource = fs.readFileSync('public/js/miien_voice.js', 'utf8');
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const response = data => ({ ok: true, json: async () => data });
let dom;
afterEach(() => { dom?.window.close(); });
function setup({ timers = false, initial = { messages: [], pending: false }, decode } = {}) {
  const html = pug.renderFile('views/miien_room.pug', {conversation:{_id:'a'.repeat(24),title:'Fixture'},moods:MOODS,canWrite:true,canTranscribe:true,csrfToken:'token'});
  dom = new JSDOM(html, { url:'https://fixture.invalid/chat5/miien/'+ 'a'.repeat(24),runScripts:'outside-only' });
  const {window:w}=dom;
  if (timers) {
    let nextTimer = 0;
    w.fixtureTimers = new Map();
    w.setTimeout = callback => { const id = ++nextTimer; w.fixtureTimers.set(id, callback); return id; };
    w.clearTimeout = id => w.fixtureTimers.delete(id);
  }
  w.fetch=jest.fn().mockResolvedValue(response(initial));
  w.MiienVoice={stop:jest.fn(),speak:jest.fn()};
  w.Image=class { constructor(){this.src='';} decode(){return decode ? decode(this.src) : Promise.resolve();} };
  w.isSecureContext=true;
  w.AudioContext=class {};
  w.OfflineAudioContext=class {};
  w.MediaRecorder=class {};
  Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:jest.fn()}});
  vm.runInContext(source,dom.getInternalVMContext());
  return w;
}
test('text works with unsupported microphone, renders hostile responses inertly',async()=>{
  const w=setup();await settle();
  expect(w.document.getElementById('send').disabled).toBe(false);
  // A separate initial render with a malicious response, without relying on implementation helpers.
  dom.window.close();
  const html=pug.renderFile('views/miien_room.pug',{conversation:{_id:'a'.repeat(24),title:'Test'},moods:['neutral'],canWrite:true,canTranscribe:true,csrfToken:'token'});
  dom=new JSDOM(html,{url:'https://fixture.invalid',runScripts:'outside-only'});
  const x=dom.window;x.Image=class{decode(){return Promise.resolve();}};
  x.fetch=jest.fn().mockResolvedValue(response({messages:[{id:'1',role:'assistant',text:'<img src=x onerror=alert(1)>',mood:'neutral'}],pending:false}));
  vm.runInContext(source,dom.getInternalVMContext());await settle();
  expect(x.document.querySelector('#history img')).toBeNull();
  expect(x.document.getElementById('latest-reply').textContent).toContain('<img');
  expect(x.document.getElementById('mic').disabled).toBe(true);
  expect(x.document.getElementById('send').disabled).toBe(false);
});
test('double submit makes one request and interrupts speech',async()=>{
  const w=setup();await settle();let resolve;
  w.fetch.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  w.document.getElementById('message').value='Hello';
  const form=w.document.getElementById('message-form');
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));form.dispatchEvent(new w.Event('submit',{cancelable:true}));
  expect(w.fetch.mock.calls.filter(([url])=>url.endsWith('/messages'))).toHaveLength(1);
  expect(w.MiienVoice.stop).toHaveBeenCalled();
  expect(w.document.getElementById('send').disabled).toBe(true);
  resolve(response({accepted:true}));await settle();expect(w.document.getElementById('message').value).toBe('');
});
test('permission resolving after Stop immediately closes tracks and cannot begin recording',async()=>{
  const w=setup();await settle();let resolve;
  w.navigator.mediaDevices.getUserMedia.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const stop=jest.fn();w.document.getElementById('mic').click();
  w.document.getElementById('stop').click();resolve({getTracks:()=>[{stop}]});await settle();
  expect(stop).toHaveBeenCalled();expect(w.document.getElementById('mic').textContent).toBe('Microphone');
});
test('permission denial preserves the draft and send control',async()=>{
  const w=setup();await settle();w.navigator.mediaDevices.getUserMedia.mockRejectedValue(new Error('denied'));
  w.document.getElementById('message').value='My draft';w.document.getElementById('mic').click();await settle();
  expect(w.document.getElementById('message').value).toBe('My draft');
  expect(w.document.getElementById('mic-status').textContent).toContain('permission');
  expect(w.document.getElementById('send').disabled).toBe(false);
});
test('late initial response after leaving cannot render or speak',async()=>{
  const w=setup();w.dispatchEvent(new w.Event('pagehide'));await settle();
  expect(w.document.getElementById('history').children).toHaveLength(0);
  expect(w.MiienVoice.speak).not.toHaveBeenCalled();expect(w.MiienVoice.stop).toHaveBeenCalled();
});
test('voice failure is separate from text and stale callbacks cannot replace stopped status',async()=>{
  const w=setup();await settle();let utterance;
  w.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  w.speechSynthesis={cancel:jest.fn(),getVoices:()=>[],addEventListener:jest.fn(),speak:jest.fn(value=>{utterance=value;})};
  vm.runInContext(voiceSource,dom.getInternalVMContext());
  w.MiienVoice.speak('hello',true);utterance.onerror();
  expect(w.document.getElementById('speech-status').textContent).toContain('blocked');
  w.MiienVoice.stop();utterance.onstart();
  expect(w.document.getElementById('speech-status').textContent).toContain('stopped');
  expect(w.document.getElementById('send').disabled).toBe(false);
});
test('network retry reuses its durable request ID while preserving edits',async()=>{
  const w=setup();await settle();w.fetch.mockRejectedValueOnce(new Error('network interrupted'));
  const input=w.document.getElementById('message');const form=w.document.getElementById('message-form');
  input.value='My message';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  expect(input.value).toBe('My message');
  const first=JSON.parse(w.fetch.mock.calls.find(([url])=>url.endsWith('/messages'))[1].body);
  w.fetch.mockResolvedValueOnce(response({duplicate:true}));form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  const requests=w.fetch.mock.calls.filter(([url])=>url.endsWith('/messages'));
  expect(JSON.parse(requests[1][1].body)).toEqual(first);expect(input.value).toBe('');
});
test('text submission still works where insecure HTTP disables randomUUID',async()=>{
  const w=setup();await settle();Object.defineProperty(w.crypto,'randomUUID',{value:undefined});
  w.fetch.mockResolvedValueOnce(response({accepted:true}));
  w.document.getElementById('message').value='Text fallback';
  w.document.getElementById('message-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  const request=w.fetch.mock.calls.find(([url])=>url.endsWith('/messages'));
  expect(JSON.parse(request[1].body).requestId).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
  expect(w.document.getElementById('message').value).toBe('');
});

test('speech waits for pending cleanup and plays a newly saved reply exactly once',async()=>{
  const w=setup({timers:true});await settle();
  Object.defineProperty(w.document, 'hidden', { value: false });
  const messages=[{id:'reply',role:'assistant',text:'Hello!',mood:'happy'}];
  const tick=async data=>{
    w.fetch.mockResolvedValueOnce(response(data));
    const poll=[...w.fixtureTimers.values()].pop();w.fixtureTimers.clear();await poll();await settle();
  };
  await tick({messages,pending:true});expect(w.MiienVoice.speak).not.toHaveBeenCalled();
  await tick({messages,pending:false});expect(w.MiienVoice.speak).toHaveBeenCalledTimes(1);
  expect(w.document.getElementById('chat-status').textContent).not.toContain('without text');
  await tick({messages,pending:false});expect(w.MiienVoice.speak).toHaveBeenCalledTimes(1);
});

async function tick(w, data) {
  w.fetch.mockResolvedValueOnce(response(data));
  const poll = [...w.fixtureTimers.values()].pop();
  w.fixtureTimers.clear();
  await poll();
  await settle();
}
const assistant = (id, text, recent = []) => ({ id, role: 'assistant', text, mood: classifyMood(text, recent) });
const element = (w, id) => w.document.getElementById(id);
function preview(w, value) {
  element(w, 'mood-override').value = value;
  element(w, 'mood-override').dispatchEvent(new w.Event('change'));
}
test('automatic portraits follow successive natural replies and bilingual context; repeated polls preserve DOM', async () => {
  const w = setup({ timers: true }); await settle();
  const messages = [];
  for (const [text, expected] of [
    ['It means the value stays in memory.', 'thoughtful'],
    ['You made it!', 'happy'], ['That sounds rough.', 'concerned'],
    ['It came out of nowhere.', 'surprised'],
  ]) {
    messages.push(assistant(String(messages.length), text));
    await tick(w, { messages, pending: false });
    expect(element(w, 'character').src).toMatch(new RegExp(`/${expected}\\.webp$`));
    expect(element(w, 'character').alt).toContain(expected);
    expect(element(w, 'latest-reply').textContent).toBe(text);
  }
  const context = { id: 'u', role: 'user', text: 'どうすれば使えますか？', mood: 'neutral' };
  messages.push(context, assistant('jp', 'Here you go.', [context]));
  await tick(w, { messages, pending: false });
  expect(element(w, 'character').src).toContain('/thoughtful.webp');
  const article = element(w, 'history').firstChild;
  await tick(w, { messages, pending: false });
  expect(element(w, 'history').firstChild).toBe(article);
});
test('manual neutral overrides later replies, then automatic restores the newest mood', async () => {
  const w = setup({ timers: true }); await settle();
  await tick(w, { messages: [assistant('1', 'You made it!')], pending: false });
  preview(w, 'neutral'); await settle();
  await tick(w, { messages: [assistant('2', 'It means we can start.')], pending: false });
  expect(element(w, 'character').src).toContain('/neutral.webp');
  expect(element(w, 'mood-label').textContent).toContain('preview');
  preview(w, 'auto'); await settle();
  expect(element(w, 'character').src).toContain('/thoughtful.webp');
  expect(element(w, 'mood-label').textContent).not.toContain('preview');
  expect(w.fetch.mock.calls.every(([url]) => url.endsWith('/state'))).toBe(true);
});
test('late decode cannot replace a newer selection; failed art keeps text and current portrait', async () => {
  let resolveHappy;
  const w = setup({ timers: true, decode: src => src.endsWith('/happy.webp')
    ? new Promise(resolve => { resolveHappy = resolve; })
    : src.endsWith('/surprised.webp') ? Promise.reject(new Error('missing')) : Promise.resolve() });
  await settle();
  preview(w, 'happy'); preview(w, 'thoughtful'); await settle();
  resolveHappy(); await settle();
  expect(element(w, 'character').src).toContain('/thoughtful.webp');
  preview(w, 'surprised'); await settle();
  expect(element(w, 'character').src).toContain('/thoughtful.webp');
  expect(element(w, 'art-status').textContent).toContain('unavailable');
  expect(element(w, 'send').disabled).toBe(false);
});
test('unknown moods and empty history safely restore neutral and clear stale replay text', async () => {
  const w = setup({ timers: true }); await settle();
  await tick(w, { messages: [assistant('1', 'You made it!')], pending: false });
  await tick(w, { messages: [{ ...assistant('2', 'Hello.'), mood: '../../unknown' }], pending: false });
  expect(element(w, 'character').src).toContain('/neutral.webp');
  expect(element(w, 'mood-label').textContent).toBe('Expression: neutral');
  await tick(w, { messages: [], pending: false });
  expect(element(w, 'latest-reply').textContent).toContain('Say hello');
  element(w, 'replay').click();
  expect(w.MiienVoice.speak).toHaveBeenLastCalledWith('', true);
});
test('history, pending-at-open, background replies and older rows never autoplay on later polls', async () => {
  const first = assistant('1', 'You made it!');
  const second = assistant('2', 'The reason is simple.');
  const w = setup({ timers: true, initial: { messages: [first, second], pending: true } });
  Object.defineProperty(w.document, 'hidden', { value: false, configurable: true });
  await settle();
  await tick(w, { messages: [first, second], pending: false });
  await tick(w, { messages: [first], pending: false });
  expect(w.MiienVoice.speak).not.toHaveBeenCalled();
  const third = assistant('3', 'That sounds rough.');
  Object.defineProperty(w.document, 'hidden', { value: true, configurable: true });
  await tick(w, { messages: [first, second, third], pending: false });
  Object.defineProperty(w.document, 'hidden', { value: false, configurable: true });
  await tick(w, { messages: [first, second, third], pending: false });
  expect(w.MiienVoice.speak).not.toHaveBeenCalled();
  const fourth = assistant('4', 'It came out of nowhere.');
  await tick(w, { messages: [first, second, third, fourth], pending: true });
  expect(element(w, 'send').disabled).toBe(true);
  await tick(w, { messages: [first, second, third, fourth], pending: false });
  await tick(w, { messages: [first, second, third, fourth], pending: false });
  expect(w.MiienVoice.speak).toHaveBeenCalledTimes(1);
  expect(w.MiienVoice.speak).toHaveBeenCalledWith(fourth.text);
});
test('a user-ended snapshot never speaks a preceding assistant; keyboard sends and IME stays editable', async () => {
  const w = setup({ timers: true }); await settle();
  Object.defineProperty(w.document, 'hidden', { value: false });
  await tick(w, { messages: [assistant('1', 'Hello.'), { id: 'u', role: 'user', text: 'Hi', mood: 'neutral' }], pending: false });
  expect(w.MiienVoice.speak).not.toHaveBeenCalled();
  element(w, 'message').value = 'Draft';
  element(w, 'message').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true }));
  expect(w.fetch.mock.calls.filter(([url]) => url.endsWith('/messages'))).toHaveLength(0);
  element(w, 'message').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
  await settle();
  expect(w.fetch.mock.calls.filter(([url]) => url.endsWith('/messages'))).toHaveLength(1);
});
test('room exposes long text, a focusable latest reply and history collapsed by default', async () => {
  const text = 'A long synthetic reply.\n'.repeat(1500);
  const w = setup({ initial: { messages: [assistant('1', text)], pending: false } }); await settle();
  expect(element(w, 'latest-reply').textContent).toBe(text);
  expect(element(w, 'latest-reply').tabIndex).toBe(0);
  expect(w.document.querySelector('details.transcript').open).toBe(false);
  expect(element(w, 'history').textContent).toContain(text);
  expect(element(w, 'message-form').closest('.stage')).not.toBeNull();
});
