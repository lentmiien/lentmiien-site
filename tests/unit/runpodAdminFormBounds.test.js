const {
  RUNPOD_FORM_MAX_BYTES,
  RUNPOD_FORM_MAX_FIELDS,
  requireBoundedRunpodForm,
} = require('../../routes/runpodAdmin');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    render: jest.fn().mockReturnThis(),
  };
}

function postRequest(body = {}, { contentLength } = {}) {
  return {
    method: 'POST',
    body,
    user: { name: 'admin' },
    is: jest.fn((type) => type === 'application/x-www-form-urlencoded'),
    get: jest.fn((name) => name === 'content-length' ? contentLength : null),
  };
}

describe('Runpod admin form bounds', () => {
  test('accepts a small URL-encoded browser form', () => {
    const next = jest.fn();

    requireBoundedRunpodForm(postRequest({ name: 'pod', gpuCount: '1' }), response(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects unsupported content types and declared oversized bodies', () => {
    const wrongType = postRequest({ name: 'pod' });
    wrongType.is.mockReturnValue(false);
    const wrongTypeResponse = response();
    requireBoundedRunpodForm(wrongType, wrongTypeResponse, jest.fn());
    expect(wrongTypeResponse.status).toHaveBeenCalledWith(415);

    const oversizedResponse = response();
    requireBoundedRunpodForm(
      postRequest({}, { contentLength: String(RUNPOD_FORM_MAX_BYTES + 1) }),
      oversizedResponse,
      jest.fn()
    );
    expect(oversizedResponse.status).toHaveBeenCalledWith(413);
  });

  test('rejects duplicate/object values, too many fields, and computed oversized data', () => {
    for (const body of [
      { name: ['one', 'two'] },
      Object.fromEntries(Array.from({ length: RUNPOD_FORM_MAX_FIELDS + 1 }, (_, index) => [`f${index}`, 'x'])),
      { name: 'x'.repeat(RUNPOD_FORM_MAX_BYTES) },
    ]) {
      const res = response();
      const next = jest.fn();
      requireBoundedRunpodForm(postRequest(body), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(413);
    }
  });

  test('does not interfere with GET dashboard requests', () => {
    const next = jest.fn();
    requireBoundedRunpodForm({ method: 'GET' }, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
