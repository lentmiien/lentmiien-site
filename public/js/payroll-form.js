/* Very small helper to duplicate a row in the earnings / deductions tables */

function cloneRow(tblId, namePrefix) {
  const tbody = document.querySelector(`#${tblId} tbody`);
  const last  = tbody.querySelector('tr:last-child');
  const clone = last.cloneNode(true);

  clone.querySelectorAll('input').forEach(el => {
    el.value = '';
  });

  tbody.appendChild(clone);
}

function addEarn () { cloneRow('earn-table',  'earn');   }
function addDeduct() { cloneRow('deduct-table', 'deduct');}
