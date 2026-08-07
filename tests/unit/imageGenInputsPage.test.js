const fs = require('fs');
const path = require('path');
const pug = require('pug');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

describe('/image_gen workflow input library', () => {
  test('renders generic upload, browse, preview, and workflow selection controls', () => {
    const html = pug.renderFile(projectFile('views', 'image_gen', 'index.pug'), {
      pageTitle: 'ComfyUI Studio',
      loggedIn: true,
      admin: false,
      permissions: ['image_gen'],
      htmlPaths: [],
      bookmarks: [],
      currentPath: '/image_gen',
    });

    expect(html).toContain('id="inputUploadForm"');
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('type="file" name="file"');
    expect(html).toContain('name="subfolder"');
    expect(html).toContain('name="overwrite" value="true"');
    expect(html).toContain('id="inputGrid"');
    expect(html).toContain('id="inputTargetField"');
    expect(html).toContain('id="btnUseInput"');
    expect(html).toContain('image, audio, video, or other input data');
    expect(html).toContain('<script src="/js/image_gen.js"></script>');
  });

  test('registers Gateway-backed input list, preview, and generic upload routes', () => {
    const routeSource = fs.readFileSync(projectFile('routes', 'image_gen.js'), 'utf8');
    const clientSource = fs.readFileSync(projectFile('public', 'js', 'image_gen.js'), 'utf8');

    expect(routeSource).toContain("router.get('/api/files/:bucket', ctrl.listFiles);");
    expect(routeSource).toContain("router.get('/api/files/input/view', ctrl.getInputFile);");
    expect(routeSource).toContain("router.post('/api/files/input', upload.single('file'), ctrl.uploadInput);");
    expect(clientSource).toContain("api('/api/files/input', { method: 'POST', body: formData })");
    expect(clientSource).toContain('/image_gen/api/files/input/view?path=');
    expect(clientSource).toContain("document.createElement('audio')");
    expect(clientSource).toContain("document.createElement('video')");
    expect(clientSource).toContain('existing.value = selectedInputFile.path;');
  });
});
