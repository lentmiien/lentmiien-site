const loader = require('../../public/js/lego-sculpture-converter-loader');

function validGlbBuffer() {
  const buffer = new ArrayBuffer(12);
  const header = new DataView(buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, buffer.byteLength, true);
  return buffer;
}

class TestFile {
  constructor(parts, name, options) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
  }
}

describe('Lego sculpture converter linked-model loader', () => {
  test('leaves the normal file chooser flow alone without a linked job', () => {
    expect(loader.parseLinkedModel('')).toBeNull();
    expect(loader.parseLinkedModel('?unrelated=value')).toBeNull();
  });

  test.each([
    ['trellis2', 'TRELLIS.2', '/trellis2/jobs/job-123/download', 'trellis2-job-123.glb'],
    ['pixal3d', 'Pixal3D', '/pixal3d/jobs/job-123/download', 'pixal3d-job-123.glb'],
  ])('builds an allowlisted %s download request', (source, sourceLabel, downloadUrl, fileName) => {
    expect(loader.parseLinkedModel('?source=' + source + '&jobId=job-123')).toEqual({
      source,
      sourceLabel,
      jobId: 'job-123',
      downloadUrl,
      fileName,
    });
  });

  test.each([
    '?source=https://example.com/model.glb&jobId=job-123',
    '?source=other&jobId=job-123',
    '?source=trellis2&jobId=../../admin',
    '?source=trellis2&jobId=',
    '?jobId=job-123',
  ])('rejects an invalid linked-job request: %s', (search) => {
    expect(() => loader.parseLinkedModel(search)).toThrow('This model link is invalid');
  });

  test('fetches a valid GLB from the authenticated same-origin endpoint', async () => {
    const request = loader.parseLinkedModel('?source=trellis2&jobId=job-123');
    const buffer = validGlbBuffer();
    const fetchImpl = jest.fn().mockResolvedValue({
      arrayBuffer: jest.fn().mockResolvedValue(buffer),
      ok: true,
      redirected: false,
    });
    const signal = { aborted: false };

    const file = await loader.fetchLinkedModel(request, {
      fetchImpl,
      FileConstructor: TestFile,
      signal,
    });

    expect(fetchImpl).toHaveBeenCalledWith('/trellis2/jobs/job-123/download', {
      credentials: 'same-origin',
      headers: {
        Accept: 'model/gltf-binary, application/octet-stream',
      },
      signal,
    });
    expect(file.name).toBe('trellis2-job-123.glb');
    expect(file.type).toBe('model/gltf-binary');
    expect(file.parts).toEqual([buffer]);
  });

  test('rejects login redirects, unavailable jobs, and non-GLB responses', async () => {
    const request = loader.parseLinkedModel('?source=pixal3d&jobId=job-123');
    const options = { FileConstructor: TestFile };

    await expect(loader.fetchLinkedModel(request, {
      ...options,
      fetchImpl: jest.fn().mockResolvedValue({ ok: true, redirected: true }),
    })).rejects.toThrow('session expired');
    await expect(loader.fetchLinkedModel(request, {
      ...options,
      fetchImpl: jest.fn().mockResolvedValue({ ok: false, redirected: false }),
    })).rejects.toThrow('unavailable');
    await expect(loader.fetchLinkedModel(request, {
      ...options,
      fetchImpl: jest.fn().mockResolvedValue({
        arrayBuffer: jest.fn().mockResolvedValue(new TextEncoder().encode('<html>').buffer),
        ok: true,
        redirected: false,
      }),
    })).rejects.toThrow('valid GLB');
  });
});
