const editor = new toastui.Editor({
  el: document.querySelector('#editor'),
  height: '500px',
  initialEditType: 'wysiwyg',
  previewStyle: 'vertical'
});

// Get Markdown when sending to the server
const markdownContent = editor.getMarkdown();