async function DeleteTransaction(id) {
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
  const element = document.getElementById(id);
  element.parentNode.removeChild(element);
}