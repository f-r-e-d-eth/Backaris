const folders = [
  {name:'Documents', path:'/home/fred/Documents', last:'2026-09-25 18:43', changes:'37 files', detail:'+12 / ~20 / -5', size:'1.2 GB', color:'#00e0ff'},
  {name:'Pictures', path:'/home/fred/Pictures', last:'2026-09-12 10:21', changes:'184 files', detail:'+72 / ~98 / -14', size:'5.8 GB', color:'#8a4dff'},
  {name:'Projects', path:'/home/fred/Projects', last:'2026-09-28 16:02', changes:'12 files', detail:'+5 / ~6 / -1', size:'320 MB', color:'#ff2ec4'},
  {name:'Memaris', path:'/home/fred/Memaris', last:'2026-09-29 09:14', changes:'3 files', detail:'+1 / ~2 / -0', size:'48 MB', color:'#ffd84d'},
  {name:'Cramaris', path:'/home/fred/Cramaris', last:'2026-09-29 09:16', changes:'0 files', detail:'', size:'0 B', color:'#00efc3'}
];

const changes = [
  ['new','+','Taxes/2026/receipt.pdf','Documents','2026-09-29 14:21','2.4 MB'],
  ['modified','~','report.docx','Projects','2026-09-29 13:02','1.1 MB'],
  ['modified','~','ideas.txt','Documents','2026-09-29 11:17','12 KB'],
  ['new','+','vacation.jpg','Pictures','2026-09-29 10:03','5.6 MB'],
  ['deleted','−','old_test.txt','Projects','2026-09-28 20:14','8 KB'],
  ['modified','~','design.fig','Cramaris','2026-09-28 18:41','3.2 MB'],
  ['new','+','screenshot.png','Memaris','2026-09-28 16:55','1.8 MB'],
  ['modified','~','notes.txt','Documents','2026-09-28 14:22','4 KB'],
  ['deleted','−','draft_old.docx','Projects','2026-09-27 19:03','42 KB']
];

const folderRows = document.getElementById('folderRows');
folders.forEach((f, index) => {
  const row = document.createElement('div');
  row.className = 'folder-row';
  const heights = Array.from({length:12}, (_,i) => 5 + ((index * 13 + i * 9) % 24));
  row.innerHTML = `
    <div class="folder-cell" style="color:${f.color}">
      <span class="folder-icon"></span>
      <span class="folder-name"><strong style="color:#d7efff">${f.name}</strong><small>${f.path}</small></span>
    </div>
    <span>${f.last.replace(' ','<br>')}</span>
    <span class="changed">${f.changes}<small style="display:block;color:#5bd7dc">${f.detail}</small></span>
    <span>${f.size}</span>
    <span class="spark">${heights.map(h=>`<i style="height:${h}px"></i>`).join('')}</span>`;
  folderRows.appendChild(row);
});

function renderChanges(type='all') {
  const host = document.getElementById('changeRows');
  host.innerHTML = '';
  changes.filter(c => type === 'all' || c[0] === type).forEach(c => {
    const row = document.createElement('div');
    row.className='change-row';
    row.innerHTML = `<span class="type-${c[0]}"><b>${c[1]}</b></span><span>${c[2]}</span><span>${c[3]}</span><span>${c[4]}</span><span>${c[5]}</span>`;
    host.appendChild(row);
  });
}
renderChanges();

document.querySelectorAll('.chip').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
  button.classList.add('active');
  renderChanges(button.dataset.type);
}));

const chart = document.getElementById('barChart');
[30,18,24,42,60,75,90,70,52,45,67,56,73,95,62,48,37,30,34,38,42,58,69,75,66,80,48,61,79,79].forEach(h => {
  const bar = document.createElement('i');
  bar.style.height = h + '%';
  chart.appendChild(bar);
});

document.getElementById('backupButton').addEventListener('click', () => {
  const toast = document.getElementById('toast');
  toast.textContent = 'Backup simulation started — mockup only.';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
});