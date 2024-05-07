const roles = JSON.parse(document.getElementById("roles").innerHTML);
const selection = JSON.parse(document.getElementById("selection").innerHTML);
const input_form = document.getElementById("input_form");

function UpdateInputForm(select) {
  const value = select.value;
  const type = selection.role_list.indexOf(value) >= 0 ? 'group' : 'user';
  const cb = document.getElementsByName("route_permissions");

  // Clear checkboxes
  for (let i = 0; i < cb.length; i++) {
    cb[i].checked = false;
  }

  // Set values
  document.getElementById("role").value = value;
  document.getElementById("type").value = type;
  for (let i = 0; i < roles.length; i++) {
    if (roles[i].name === value) {
      // Set pre-existing checkbox values
      roles[i].permissions.forEach(e_id => {
        document.getElementById(e_id).checked = true;
      });
    }
  }
}
