const fs = require('fs');
const { JSDOM } = require('jsdom');
let dom;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const response = (data, ok = true) => ({ ok, redirected: false, json: async () => data });
async function fixture() {
  dom = new JSDOM(`<select id="categorySelect"></select><input id="business"><datalist id="tagList"></datalist>
    <form id="budgetTransactionForm"><input name="amount" value="10"><input name="date" value="20260831"></form>
    <div class="synthetic-id"><button class="btn-outline-danger">Delete</button></div>`, { runScripts: 'outside-only' });
  const win = dom.window;
  win.alert = jest.fn();
  win.fetch = jest.fn(async url => response(url.endsWith('/lists') ? { categories: [], accounts: [], tags: [], types: [] } : {}));
  win.eval(fs.readFileSync('public/js/budget_dashboard.js', 'utf8'));
  await flush();
  return { win, form: win.document.querySelector('form'), button: win.document.querySelector('button') };
}
afterEach(() => dom?.window.close());
test.each(['busy', 'closed', 'validation', 'network', 'unconfirmed'])('rejected insert preserves input and never reports saved: %s', async failure => {
  const { win, form } = await fixture();
  form.elements.amount.value = '25';
  const reset = jest.spyOn(form, 'reset');
  if (failure === 'network') win.fetch.mockRejectedValueOnce(new Error('Network unavailable'));
  else win.fetch.mockResolvedValueOnce(response(failure === 'unconfirmed' ? {} : { error: `${failure} ledger` }, failure === 'unconfirmed'));
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(reset).not.toHaveBeenCalled();
  expect(form.elements.amount.value).toBe('25');
  expect(win.alert).toHaveBeenCalledTimes(1);
  expect(win.alert).not.toHaveBeenCalledWith('saved!');
  if (['busy', 'closed', 'validation'].includes(failure)) expect(win.alert).toHaveBeenCalledWith(`${failure} ledger`);
});
test.each(['busy', 'closed', 'network', 'unconfirmed'])('rejected delete keeps row and restores button: %s', async failure => {
  const { win, button } = await fixture();
  if (failure === 'network') win.fetch.mockRejectedValueOnce(new Error('Network unavailable'));
  else win.fetch.mockResolvedValueOnce(response(failure === 'unconfirmed' ? {} : { error: `${failure} ledger` }, failure === 'unconfirmed'));
  await win.DeleteTransaction('synthetic-id', button);
  expect(button.isConnected).toBe(true);
  expect(button.disabled).toBe(false);
  expect(button.classList.contains('btn-outline-danger')).toBe(true);
  expect(win.alert).toHaveBeenCalledTimes(1);
});
test('acknowledged writes reset the saved form and remove only the deleted row', async () => {
  const { win, form, button } = await fixture();
  const reset = jest.spyOn(form, 'reset');
  win.fetch.mockResolvedValueOnce(response({ _id: 'new-id' }));
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(reset).toHaveBeenCalledTimes(1);
  expect(win.alert).toHaveBeenCalledWith('saved!');
  win.fetch.mockResolvedValueOnce(response({ deletedId: 'synthetic-id' }));
  await win.DeleteTransaction('synthetic-id', button);
  expect(button.isConnected).toBe(false);
  expect(win.fetch).toHaveBeenLastCalledWith('/budget/delete/synthetic-id', expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) }));
});
