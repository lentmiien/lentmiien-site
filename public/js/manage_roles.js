const roles = JSON.parse(document.getElementById('roles').textContent);
const selector = document.getElementById('selection');
const filter = document.getElementById('permission-filter');
const groups = document.querySelectorAll('.permission-group');

selector.addEventListener('change', () => {
  const name = selector.value;
  const type = selector.selectedOptions[0].dataset.type;
  document.getElementById('type').value = type || '';
  document.getElementById('update-role').disabled = !type;
  const record = roles.find(role => role.name === name && role.type === type);
  const grants = new Set(record?.permissions);
  for (const checkbox of document.getElementsByName('route_permissions')) {
    checkbox.checked = grants.has(checkbox.value);
  }
});

filter.addEventListener('input', () => {
  const query = filter.value.trim().toLowerCase();
  let anyMatches = false;
  for (const group of groups) {
    const feature = group.querySelector('legend').textContent.toLowerCase();
    let groupMatches = false;
    for (const option of group.querySelectorAll('.permission-option')) {
      const permission = option.querySelector('input').value.toLowerCase();
      option.hidden = !feature.includes(query) && !permission.includes(query);
      if (!option.hidden) groupMatches = true;
    }
    group.hidden = !groupMatches;
    if (groupMatches) anyMatches = true;
  }
  document.getElementById('no-matches').hidden = anyMatches;
});
