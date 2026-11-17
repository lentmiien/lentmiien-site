const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

test.each(['soonest', '8h'])('slider sends 8h and displays fallback only for effective %s', effective => {
  const dom = new JSDOM('<input id="completionWindow" value="0"><output id="completionWindowValue"></output><p id="completionWindowNotice"></p><span id="id">conv</span>');
  try {
    const source = fs.readFileSync('public/js/chat5_5.js', 'utf8');
    const emit = jest.fn((event, payload, ack) => ack({ ok: true, completionWindow: effective }));
    const context = {
      document: dom.window.document, socket: { emit }, editor: { getMarkdown: () => '' },
      showLoadingPopup: jest.fn(), hideLoadingPopup: jest.fn(), collectChatSettings: () => ({}), alert: jest.fn(),
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('const completionWindows ='), source.indexOf('function GenerateTTS()')), context);
    const slider = context.document.getElementById('completionWindow');
    slider.value = '2';
    slider.dispatchEvent(new dom.window.Event('input'));
    expect(slider.getAttribute('aria-valuetext')).toBe('8h');
    expect(context.document.getElementById('completionWindowValue').textContent).toBe('8h');
    context.Append(false, true);
    expect(emit).toHaveBeenCalledWith('chat5-append', expect.objectContaining({ completionWindow: '8h' }), expect.any(Function));
    expect(context.document.getElementById('completionWindowNotice').textContent)
      .toBe(effective === 'soonest' ? 'Request sent with “soonest”: the selected model does not support discounted completion windows.' : '');
  } finally {
    dom.window.close();
  }
});
