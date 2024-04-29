const accounts_data = JSON.parse(document.getElementById("accounts_data").innerHTML);
const account_lookup = JSON.parse(document.getElementById("account_lookup").innerHTML);
const categories_data = JSON.parse(document.getElementById("categories_data").innerHTML);
const category_lookup = JSON.parse(document.getElementById("category_lookup").innerHTML);
const category_lookup_rev = JSON.parse(document.getElementById("category_lookup_rev").innerHTML);
const tags_data = JSON.parse(document.getElementById("tags_data").innerHTML);
const input_network = JSON.parse(document.getElementById("input_network").innerHTML);

function SetValue(value, element_id) {
  // Get value to use
  let use_value = value;
  if (element_id === "categories") use_value = category_lookup[value];

  // Abort if the value is already set
  if (document.getElementById(element_id).value.indexOf(use_value) >= 0) return;

  // Set value
  if (element_id === "categories") {
    if (document.getElementById(element_id).value.length > 0) {
      document.getElementById(element_id).value += '|'
    }
    document.getElementById(element_id).value += `${use_value}@1`;
  } else if (element_id === "tags") {
    if (document.getElementById(element_id).value.length > 0) {
      document.getElementById(element_id).value += '|'
    }
    document.getElementById(element_id).value += use_value;
  } else {
    document.getElementById(element_id).value = use_value;
  }

  // Refresh input controls
  RefreshForm();
}

function AddInputValue(this_element, element_id) {
  SetValue(this_element.value, element_id);
}

const elms = {
  from_account: document.getElementById("from_account"),
  from_account_options: document.getElementById("from_account_options"),
  to_account: document.getElementById("to_account"),
  to_account_options: document.getElementById("to_account_options"),
  from_fee: document.getElementById("from_fee"),
  from_fee_options: document.getElementById("from_fee_options"),
  to_fee: document.getElementById("to_fee"),
  to_fee_options: document.getElementById("to_fee_options"),
  amount: document.getElementById("amount"),
  amount_options: document.getElementById("amount_options"),
  date: document.getElementById("date"),
  date_options: document.getElementById("date_options"),
  transaction_business: document.getElementById("transaction_business"),
  transaction_business_options: document.getElementById("transaction_business_options"),
  type: document.getElementById("type"),
  type_options: document.getElementById("type_options"),
  categories: document.getElementById("categories"),
  categories_options: document.getElementById("categories_options"),
  tags: document.getElementById("tags"),
  tags_options: document.getElementById("tags_options")
};
function RefreshForm() {
  const options = {};
  const process_fields = [
    "from_account",
    "to_account",
    "from_fee",
    "to_fee",
    "amount",
    "transaction_business",
    "type",
    "categories",
    "tags"
  ];
  const filter_fields = [
    "from_account",
    "to_account",
    "transaction_business",
    "type",
    "categories",
    "tags"
  ];

  process_fields.forEach(pf => {
    options[pf] = input_network.all[pf].filter((a) => {
      for (let u = 0; u < filter_fields.length; u++) {
        const f = filter_fields[u];
        if (elms[f].value.length > 0) {
          let vals = elms[f].value.split("|");
          if (f === "categories") {
            vals = vals.map(a => category_lookup_rev[a.split("@")[0]]._id);
          }
          for (let t = 0; t < vals.length; t++) {
            if (vals[t] in input_network[f]) {
              if (input_network[f][vals[t]][pf].indexOf(a.value) === -1) return false;
            }
          }
        }
      }
      return true;
    });

    elms[`${pf}_options`].innerHTML = "";
    for (let c = 0; c < options[pf].length && c < 10; c++) {
      const a = options[pf][c];
      let title = a.value;
      if (pf === "from_account" || pf === "to_account") title = account_lookup[title];
      if (pf === "categories") title = category_lookup[title];
      if (document.getElementById(pf).value.indexOf(`${title}`) === -1 &&
          document.getElementById(pf).value.indexOf(`${a.value}`) === -1) {
        const div = document.createElement("div");
        div.classList.add("btn", "btn-secondary");
        div.innerText = title;
        div.setAttribute("onclick", `SetValue('${a.value}','${pf}')`);
        elms[`${pf}_options`].append(div);
      }
    }
    if (options[pf].length === 1 && document.getElementById(pf).value === "") {
      SetValue(options[pf][0].value,pf);
      return;
    }
  });
}
RefreshForm();

function FilterDropdown(filter_text_element, filter_element_class) {
  const text = document.getElementById(filter_text_element).value.toUpperCase();
  const elements = document.getElementsByClassName(filter_element_class);
  
  for (let i = 0; i < elements.length; i++) {
    if (text.length === 0) elements[i].style.display = "block";
    else {
      if (elements[i].innerHTML.toUpperCase().indexOf(text) >= 0) {
        elements[i].style.display = "block";
      } else {
        elements[i].style.display = "none";
      }
    }
  }
}

function SetDropdownValue(element_id, value) {
  document.getElementById(element_id).value = value;
  RefreshForm();
}
