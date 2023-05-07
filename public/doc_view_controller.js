const doc_data = JSON.parse(document.getElementById("doc_data").innerHTML);
const text_data = JSON.parse(document.getElementById("text_data").innerHTML);

function AddTextnodeToElement(textnode, element) {
  element.innerHTML = "";

  // Numbering
  let number = "";
  if ("number" in element.dataset) {
    number = element.dataset.number;
  }
  
  const title = document.createElement(`h${number.split('-').length + 1 <= 5 ? number.split('-').length + 1 : 5}`);
  title.innerText = (number.length > 0 ? number + ': ' : '') + textnode.title;
  title.classList.add("textcontent");
  const text = document.createElement("div");
  const data = JSON.parse(textnode.text);

  if (number.length > 0) number += '-';
  let number_count = 1;
  data.forEach((d, i) => {
    if (d.length > 0) {
      const this_number = number + number_count;
      number_count++;

      const textcontent = document.createElement("p");
      textcontent.innerHTML = d.split("\n").join("<br>");
      textcontent.classList.add("textcontent");
      const child_slot = document.createElement("div");
      child_slot.id = `${textnode._id}_${i}`;
      child_slot.classList.add("text_chunk");
      child_slot.dataset.number = this_number;
      child_slot.append(textcontent);
      text.append(child_slot);
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

async function Translate() {
  const lang = document.getElementById("lang").innerHTML;
  if (lang != "original") {
    const textcontent = document.getElementsByClassName("textcontent");
    const url = '/gptdocument/translate';
    for (let i = 0; i < textcontent.length; i++) {
      const messages = [
        {
          role: 'system',
          content: `You are a helpful translater, always responding with a translation of the text you are given in ${lang}. ${doc_data.document_type}`,
        },
        {
          role: 'user',
          content: `Please translate the text below to ${lang}.\n---\n${textcontent[i].innerHTML.split('<br>').join('\n')}`,
        }
      ];

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ messages })
      });

      const data = await response.json();
      const parts = data.resp.split("\n---\n");
      textcontent[i].innerHTML = parts[parts.length-1].split('\n').join('<br>');
    }
  }
}
Translate();
