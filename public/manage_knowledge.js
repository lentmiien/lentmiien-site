const current_templates = JSON.parse(document.getElementById("current_templates").innerText);
const backward_templates = JSON.parse(document.getElementById("backward_templates").innerText);
const knowledges = JSON.parse(document.getElementById("knowledges").innerText);

const version = document.getElementById("version");

function UpdateVersion(element) {
  const title = element.value;
  version.value = 1;
  current_templates.forEach(t => {
    if (t.title === title) {
      version.value = t.version + 1;
    }
  });
}

async function Delete(id) {
  // Call API
  const response = await fetch("/chat3/manage_knowledge_delete_template", {
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
    body: JSON.stringify({id}), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);
  if(status.status === "OK") {
    open(`/chat3/manage_knowledge`, "_self");
  } else {
    alert(status.msg);
  }
}

function Copy(id) {
  current_templates.forEach(t => {
    if (t._id.toString() === id) {
      const title = document.getElementById("title");
      title.value = t.title;
      UpdateVersion(title);
      document.getElementById("description").value = t.description;
      const json_data = JSON.parse(t.dataFormat);
      const dataFormat = document.getElementById("dataFormat");
      dataFormat.value = "";
      const value_array = [];
      json_data.forEach(data => {
        value_array.push(`${data.data_label}:${data.data_type}:${data.required ? "true" : "false"}:${data.for_embedding ? "true" : "false"}`);
      });
      dataFormat.value = value_array.join("\n");
    }
  });
  backward_templates.forEach(t => {
    if (t._id.toString() === id) {
      const title = document.getElementById("title");
      title.value = t.title;
      UpdateVersion(title);
      document.getElementById("description").value = t.description;
      const json_data = JSON.parse(t.dataFormat);
      const dataFormat = document.getElementById("dataFormat");
      dataFormat.value = "";
      const value_array = [];
      json_data.forEach(data => {
        value_array.push(`${data.data_label}:${data.data_type}:${data.required ? "true" : "false"}:${data.for_embedding ? "true" : "false"}`);
      });
      dataFormat.value = value_array.join("\n");
    }
  });
}
