const chat_hist = JSON.parse(document.getElementById("chat_hist").innerText);

async function ExportToChat3() {
  /* chat_hist
  [
    {
      "title": "Small images",
      "role": "system",
      "model": "gpt-4-1106-preview",
      "raw_content": "You are a helpful assistant.",
      "content": "<p>You are a helpful assistant.</p>\n",
      "date": "2023-11-19T09:37:26.362Z",
      "tokens": 0
    },
    {
      "title": "Small images",
      "role": "user",
      "model": "gpt-4-1106-preview",
      "raw_content": "How can I easily make the function of showing images of a max height of 100 pixels in a HTML page, and when the user click the image, it will show the full size image as a popup. Then you just click again to hide, and you can then click again or click another image, to show.",
      "content": "<p>How can I easily make the function of showing images of a max height of 100 pixels in a HTML page, and when the user click the image, it will show the full size image as a popup. Then you just click again to hide, and you can then click again or click another image, to show.</p>\n",
      "date": "2023-11-19T09:37:27.362Z",
      "tokens": 81
    },
    {
      "title": "Small images",
      "role": "assistant",
      "model": "gpt-4-1106-preview",
      "raw_content": "You can accomplish this using a combination of HTML, CSS, and JavaScript. Here's a simple example that .......",
      "content": "<p>You can accomplish this using a combination of HTML, CSS, and JavaScript. Here&#39;s a simple example that ........",
      "date": "2023-11-19T09:37:55.051Z",
      "tokens": 838
    },
    ...
  ]
  */

  // Prepare a message array with below content
  const messages = [];
  /*
  ContentText: req.body.message[i].ContentText,
  ContentTokenCount: req.body.message[i].ContentTokenCount,
  SystemPromptText: req.body.message[i].SystemPromptText,
  UserOrAssistantFlag: req.body.message[i].UserOrAssistantFlag,
  UserID: req.body.message[i].UserID,
  Title: req.body.message[i].Title,
  Images: req.body.message[i].Images,
  Sounds: req.body.message[i].Sounds,
  */

  // Send message array as POST request to '/chat3/import'
}
