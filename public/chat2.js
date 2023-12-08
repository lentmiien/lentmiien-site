const chat_hist = JSON.parse(document.getElementById("chat_hist").innerText);

// TODO finish this function
async function ExportToChat3() {
  let SystemPromptText = "";
  chat_hist.forEach(d => {
    if (d.role === "system") {
      SystemPromptText = d.raw_content;
    }
  });

  // Prepare a message array with below content
  const messages = [];
  chat_hist.forEach(d => {
    if (d.role != "system") {
      messages.push({
        ContentText: d.raw_content,
        ContentTokenCount: d.tokens,
        SystemPromptText,
        UserOrAssistantFlag: d.role === "user",
        UserID: "Lennart",
        Title: d.title,
        Images: "",
        Sounds: "",
      });
    }
  });

  // Send message array as POST request to '/chat3/import'

  // Call API
  const response = await fetch("/chat3/import", {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    mode: "cors", // no-cors, *cors, same-origin
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, *same-origin, omit
    headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: "follow", // manual, *follow, error
    referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify({messages}), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  if(status.status === "OK") {
    open(`/chat3?id=${status.id}`, "_self");
  } else {
    alert(status.msg);
  }
}
