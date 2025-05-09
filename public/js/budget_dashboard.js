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

/* ────────────────────────────────────────────────────────────────
   1.  Helper for AJAX
   ────────────────────────────────────────────────────────────────*/
   async function api(path, opts={}) {
    const res = await fetch(path, {
      headers: {'Content-Type':'application/json'},
      credentials:'same-origin',
      ...opts
    });
    return res.json();
  }
  
  /* ────────────────────────────────────────────────────────────────
     2.  CATEGORY LINE  CHART
     ────────────────────────────────────────────────────────────────*/
  const sel     = document.getElementById('categorySelect');
  const chartEl = document.getElementById('chart');
  const MARGIN  = {top:20,right:10,bottom:30,left:50};
  const WIDTH   = 900, HEIGHT = 350;
  
  let svg, xScale,yScale,line,colors;
  
  async function loadCategories(){
   const [raw, lists] = await Promise.all([
         api('/budget/api/summary'),          // totals keyed by id
         api('/budget/api/lists')             // we need id → title map
   ]);
   const id2title = Object.fromEntries(
         lists.categories.map(c=>[c._id, c.title]));
 
   // feed <select>
   Object.keys(raw).forEach(id=>{
       const o=document.createElement('option');
       o.value=id;
       o.textContent=id2title[id.split("@")[0]] || id;      // fall back if no title
       sel.appendChild(o);
   });
   sel.dataset.data = JSON.stringify(raw);
 }
 
  loadCategories();

  /*  populate the 4 selects and tag-datalist  */
(async function fillReferenceLists(){
   const ref = await api('/budget/api/lists');
 
   function fill(id, data, textProp){
      const sel=document.getElementById(id);
      sel.innerHTML='<option value="">-- choose --</option>';
      data.forEach(r=>{
         const opt=document.createElement('option');
         opt.value=r._id || r;                 // r is string for types
         opt.textContent=r[textProp] || r;
         sel.appendChild(opt);
      });
   }
   fill('from', ref.accounts ,'name');
   fill('to',   ref.accounts ,'name');
   fill('cat',  ref.categories,'title');
   fill('type', ref.types);
 
   // tags datalist
   const dl=document.getElementById('tagList');
   ref.tags.forEach(t=>{
      const o=document.createElement('option');
      o.value=t; dl.appendChild(o);
   });
 })();
  
  /* draw when user chooses category */
  sel.addEventListener('change', e=>{
     if(!e.target.value) return;
     const raw = JSON.parse(sel.dataset.data)[e.target.value];
     drawLines(e.target.value, raw);
  });
  
  function drawLines(category, data){
     // data = {year: [12 nums]}
     chartEl.innerHTML='';          // reset
     svg = d3.select(chartEl)
             .append('svg')
             .attr('width', WIDTH)
             .attr('height',HEIGHT);
     const years = Object.keys(data);
     const allValues = years.flatMap(y=>data[y]);
     yScale = d3.scaleLinear()
                .domain([0, d3.max(allValues)]).nice()
                .range([HEIGHT-MARGIN.bottom,MARGIN.top]);
     xScale = d3.scalePoint()
                .domain(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])
                .range([MARGIN.left, WIDTH-MARGIN.right]);
     colors = d3.scaleOrdinal().domain(years).range(d3.schemeTableau10);
     line = d3.line()
              .x((d,i)=>xScale(xScale.domain()[i]))
              .y(d=>yScale(d));
     years.forEach(y=>{
        svg.append('path')
           .datum(data[y])
           .attr('fill','none')
           .attr('stroke',colors(y))
           .attr('stroke-width',2)
           .attr('d',line)
           .attr('class','yearLine');
        // dots & click handler
        svg.selectAll(`.dot-${y}`)
           .data(data[y])
           .enter()
           .append('circle')
           .attr('class',`dot-${y}`)
           .attr('cx',(d,i)=>xScale(xScale.domain()[i]))
           .attr('cy',d=>yScale(d))
           .attr('r',4)
           .attr('fill',colors(y))
           .style('cursor','pointer')
           .on('click',(ev,d)=>showBreakdown(category,y,Math.round(1+11*(ev.clientX-60)/840)));
     });
     // axes
     svg.append('g')
        .attr('transform',`translate(0,${HEIGHT-MARGIN.bottom})`)
        .call(d3.axisBottom(xScale));
     svg.append('g')
        .attr('transform',`translate(${MARGIN.left},0)`)
        .call(d3.axisLeft(yScale));
  }
  
  /* ────────────────────────────────────────────────────────────────
     3.  PIE chart in modal
     ────────────────────────────────────────────────────────────────*/
     async function showBreakdown(cat,year,month){
      console.log(cat,year,month);
      const bd  = await api(`/budget/api/breakdown/${cat}/${year}/${month}`);
      const rows = bd.rows;
   
      /* ---- clear containers first ---- */
      const pieBox   = d3.select('#piechart').html('');
      document.getElementById('stats').textContent = '';
   
      /* ---- only draw a pie when we actually have data ---- */
      if (rows.length) {
          const size   = 220,
                radius = size / 2;
          const svg = pieBox.append('svg')
                            .attr('width', size)
                            .attr('height', size)
                            .style('pointer-events','none')      // avoid overlay problems
                            .append('g')
                            .attr('transform',`translate(${radius},${radius})`);
   
          const pie  = d3.pie().value(d=>d.total);
          const arc  = d3.arc().innerRadius(0).outerRadius(radius-10);
          const color= d3.scaleOrdinal()
                         .domain(rows.map(r=>r._id))
                         .range(d3.schemeSet2);
   
          svg.selectAll('path')
             .data(pie(rows))
             .enter().append('path')
             .attr('d',arc)
             .attr('fill',d=>color(d.data._id))
             .append('title')
             .text(d=>`${d.data._id}: ${d.data.total}`);
      } else {
          pieBox.append('em').text('No transactions for this month.');
      }
   
      /* ---- statistics ---- */
      document.getElementById('stats')
              .textContent = JSON.stringify(bd.stats, null, 2);
   
      /* ---- show modal (Bootstrap-5, no jQuery) ---- */
      bootstrap.Modal.getOrCreateInstance(
           document.getElementById('modalBreakdown')
      ).show();
   }
   
  
  /* ────────────────────────────────────────────────────────────────
     4.  AUTOCOMPLETE + auto-fill new transaction form
     ────────────────────────────────────────────────────────────────*/
  const businessInput = document.getElementById('business');
  let timer=null, suggestionsBox;
  businessInput.addEventListener('input',e=>{
     clearTimeout(timer);
     timer=setTimeout(async ()=>{
         const term=e.target.value;
         if(term.length<2) return;
         const list= await api(`/budget/api/business?term=${encodeURIComponent(term)}`);
         showSuggestions(list.map(i=>i.name));
     },180);
  });
  function showSuggestions(arr){
     if(!suggestionsBox){
       suggestionsBox=document.createElement('div');
       suggestionsBox.className='list-group position-absolute';
       businessInput.parentNode.appendChild(suggestionsBox);
     }
     suggestionsBox.innerHTML='';
     arr.forEach(txt=>{
        const a=document.createElement('a');
        a.className='list-group-item list-group-item-action';
        a.textContent=txt;
        a.onclick=()=>{ businessInput.value=txt; suggestionsBox.innerHTML=''; fetchDefaults(txt);};
        suggestionsBox.appendChild(a);
     });
  }
/*  map db-field  ->  real html element id  */
const FIELD2ID = {
  from_account : 'from',
  to_account   : 'to',
  from_fee     : 'from_fee',
  to_fee       : 'to_fee',
  categories   : 'cat',
  tags         : 'tags',
  type         : 'type'
};
async function fetchDefaults(name){
   const obj = await api(`/budget/api/business/values?name=${encodeURIComponent(name)}`);
   Object.keys(FIELD2ID).forEach(f=>{
      const htmlId = FIELD2ID[f];
      if (obj[f] != null && document.getElementById(htmlId).value === '') {
         document.getElementById(htmlId).value = obj[f];
      }
   });
   if(obj.amountAvg && !document.getElementById('amount').value){
      document.getElementById('amount').value = obj.amountAvg;
   }
}
  
  /* ────────────────────────────────────────────────────────────────
     5.  POST new transaction
     ────────────────────────────────────────────────────────────────*/
  document.getElementById('newTransactionForm')
  .addEventListener('submit',async ev=>{
     ev.preventDefault();
     const formData = new FormData(ev.target);
     const data = Object.fromEntries(formData.entries());
     data.amount     = parseFloat(data.amount);
     data.from_fee   = parseFloat(data.from_fee||0);
     data.to_fee     = parseFloat(data.to_fee||0);
     data.date       = parseInt(data.date);
     const res = await api('/budget/api/transaction',{
          method:'POST',
          body: JSON.stringify(data)
     });
     alert('saved!');
     ev.target.reset();
  });  
