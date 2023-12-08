const content = document.getElementsByClassName("openai_conversation");

function filter(input_element) {
  const query = input_element.value;
  for (let i = 0; i < content.length; i++) {
    if (content[i].innerHTML.indexOf(query) >= 0) {
      content[i].classList.remove('hidden');
    } else {
      content[i].classList.add('hidden');
    }
  }
}

const pdata = JSON.parse(document.getElementById("pdata").innerText);

async function ExportToChat3(index) {
  let SystemPromptText = "You are a helpful assistant.";
  let Title = pdata[index].title;

  // Prepare a message array with below content
  const messages = [];
  pdata[index].messages.forEach(d => {
    if (d.role === "user" || d.role === "assistant") {
      messages.push({
        ContentText: d.raw_content,
        ContentTokenCount: 0,
        SystemPromptText,
        UserOrAssistantFlag: d.role === "user",
        UserID: "Lennart",
        Title,
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