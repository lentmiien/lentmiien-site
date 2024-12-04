async function DeleteTransaction(id, thisButtonElement) {
  thisButtonElement.disabled = true;
  thisButtonElement.classList.remove("btn-outline-danger");
  thisButtonElement.classList.add("btn-secondary");

  // /budget/delete/${id}
  await fetch(`/budget/delete/${id}`, {
    method: "GET",
    mode: "cors",
    cache: "no-cache",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    redirect: "follow",
    referrerPolicy: "no-referrer",
  });

  // Delete from page
  const element = document.getElementsByClassName(id);
  for (let i = element.length-1; i >= 0; i--) {
    element[i].parentNode.removeChild(element[i]);
  }
}