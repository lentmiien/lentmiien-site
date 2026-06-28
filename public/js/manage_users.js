async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    mode: "cors",
    cache: "no-cache",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    redirect: "follow",
    referrerPolicy: "no-referrer",
    body: JSON.stringify(body),
  });

  return response.json();
}

function HandleAdminResponse(data, options = {}) {
  console.log(data);

  if (!data) {
    return;
  }

  if (data.temporaryPassword) {
    window.prompt(
      `${data.message || "Temporary password generated."}\nThis password will not be shown again.`,
      data.temporaryPassword
    );
  } else if (data.message && data.status !== "Completed") {
    window.alert(data.message);
  }

  if (options.reload && data.status === "Completed") {
    window.location.reload();
  }
}

async function UpdateType(element) {
  const id = element.dataset.id;
  const type = element.value;

  const data = await postJson(`/admin/set_type`, {id, type});
  HandleAdminResponse(data);
}

async function ResetPassword(element) {
  const id = element.dataset.id;

  const data = await postJson(`/admin/reset_password`, {id});
  HandleAdminResponse(data);
}

async function DeleteUser(element) {
  const id = element.dataset.id;

  const data = await postJson(`/admin/delete_user`, {id});
  HandleAdminResponse(data, { reload: true });
}

async function CreateUser() {
  const name = document.getElementById("new_user_name").value;
  const email = document.getElementById("new_user_email").value;
  const type_user = "user";

  const data = await postJson(`/admin/create_user`, {name, email, type_user});
  HandleAdminResponse(data, { reload: true });
}
