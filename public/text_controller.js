const edit_response = document.getElementById("edit_response");
const output = document.getElementById("text_nodes");
const save_tn_btn = document.getElementById("save_tn_btn");

function GenerateTextChunks() {
  output.innerHTML = "";
  const text = edit_response.value;
  const parts = text.split('\n');
  parts.forEach((d, i) => {
    const inputgroup = document.createElement("div");
    inputgroup.classList.add("input-group");
    const input_hidden = document.createElement("input");
    input_hidden.id = `chunk${i}`;
    input_hidden.name = `chunk${i}`;
    input_hidden.type = "hidden";
    input_hidden.value = d;
    const span_label = document.createElement("span");
    span_label.classList.add("input-group-text");
    span_label.innerText = d;
    const input_id = document.createElement("input");
    input_id.id = `chunk${i}_id`;
    input_id.classList.add("form-control");
    input_id.name = `chunk${i}_id`;
    input_id.type = "number"
    input_id.value = i;
    inputgroup.append(span_label, input_id);
    output.append(input_hidden, inputgroup);
  });

  save_tn_btn.disabled = false;
}
