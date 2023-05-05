const doc_data = JSON.parse(document.getElementById("doc_data").innerHTML);
const text_data = JSON.parse(document.getElementById("text_data").innerHTML);

function AddTextnodeToElement(textnode, element) {
  element.innerHTML = "";
  
  const title = document.createElement("b");
  title.innerText = textnode.title;
  const text = document.createElement("div");
  const data = JSON.parse(textnode.text);
  data.forEach((d, i) => {
    if (d.length > 0) {
      const textcontent = document.createElement("p");
      textcontent.innerHTML = d.split("\n").join("<br>");
      const child_slot = document.createElement("div");
      child_slot.id = `${textnode._id}_${i}`;
      child_slot.classList.add("text_card");
      const branch_button = document.createElement("a");
      branch_button.classList.add("btn", "btn-primary");
      branch_button.innerText = "Create branch";
      branch_button.href = `/gptdocument/branch?document_id=${textnode.document_id}&parent_node_id=${textnode._id}&parent_node_index=${i}`;
      child_slot.append(branch_button);
      text.append(textcontent, child_slot);
    }
  });

  element.append(title, text);
}
/*
  _id
  document_id: { type: String, required: true },
  parent_node_id: { type: String, required: false },
  parent_node_index: { type: Number, required: true },
  additional_context: { type: String, required: false },
  title: { type: String, required: true, max: 100 },
  text: { type: String, required: true },
  status: { type: String, required: false },
  remaining_status: { type: String, required: false },
  updated_date: { type: Date, required: true },
*/

let not_done_array = [];
text_data.forEach(data => {
  const dom_id = data.parent_node_id;
  const element = document.getElementById(dom_id);
  if (element) {
    AddTextnodeToElement(data, element);
  } else {
    not_done_array.push(data)
  }
});

let max_itter = 25;
while (not_done_array.length > 0 && max_itter > 0) {
  const workdata = not_done_array;
  not_done_array = [];

  workdata.forEach(data => {
    const dom_id = `${data.parent_node_id}_${data.parent_node_index}`;
    const element = document.getElementById(dom_id);
    if (element) {
      AddTextnodeToElement(data, element);
    } else {
      not_done_array.push(data)
    }
  });

  max_itter--;
}
