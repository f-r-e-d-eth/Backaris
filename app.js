let folders = [];
let changes = [];
const colors = ['#00e0ff','#8a4dff','#ff2ec4','#ffd84d','#00efc3'];

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units=['B','KB','MB','GB','TB']; let v=bytes, i=0;
  while(v>=1024 && i<units.length-1){v/=1024;i++;}
  return (i<2 ? Math.round(v) : v.toFixed(1))+' '+units[i];
}

function renderFolders() {
  const host=document.getElementById('folderRows'); host.innerHTML='';
  folders.forEach((f,index)=>{
    const row=document.createElement('div'); row.className='folder-row';
    const total=(f.new||0)+(f.modified||0)+(f.deleted||0);
    const detail=f.baseline ? `+${f.new} / ~${f.modified} / -${f.deleted}` : 'baseline created';
    const sizes=(f.history||[]).map(h=>h.total_size);
    let heights;
    if(sizes.length > 1) {
      const min=Math.min(...sizes), max=Math.max(...sizes), range=Math.max(max-min,1);
      heights=sizes.map(v=>6+Math.round(((v-min)/range)*22));
    } else {
      heights=[14];
    }
    row.innerHTML=`
      <div class="folder-cell" style="color:${colors[index%colors.length]}">
        <span class="folder-icon"></span>
        <span class="folder-name"><strong style="color:#d7efff">${f.name}</strong><small>${f.path}</small></span>
      </div>
      <span>${f.available ? f.file_count+' files' : 'offline'}</span>
      <span class="changed">${total} changed<small style="display:block;color:#5bd7dc">${detail}</small></span>
      <span>${f.total_size_text || '—'}</span>
      <span class="spark">${heights.map(h=>`<i style="height:${h}px"></i>`).join('')}</span>`;
    host.appendChild(row);
  });
}

function collectChanges() {
  changes=[];
  folders.forEach(f => (f.changes||[]).forEach(c => changes.push([
    c.type, c.type==='new'?'+':c.type==='modified'?'~':'−', c.path, f.name, '', formatSize(c.size)
  ])));
}

function renderChanges(type='all') {
  const host=document.getElementById('changeRows'); host.innerHTML='';
  changes.filter(c=>type==='all'||c[0]===type).slice(0,100).forEach(c=>{
    const row=document.createElement('div'); row.className='change-row';
    row.innerHTML=`<span class="type-${c[0]}"><b>${c[1]}</b></span><span>${c[2]}</span><span>${c[3]}</span><span>${c[4]||'since baseline'}</span><span>${c[5]}</span>`;
    host.appendChild(row);
  });
  const counts={new:0,modified:0,deleted:0};
  changes.forEach(c=>counts[c[0]]++);
  document.querySelector('[data-type="new"]').textContent=`New (${counts.new})`;
  document.querySelector('[data-type="modified"]').textContent=`Modified (${counts.modified})`;
  document.querySelector('[data-type="deleted"]').textContent=`Deleted (${counts.deleted})`;
}

function updateStats() {
  const total=changes.length;
  const bytes=changes.filter(c=>c[0]!=='deleted').reduce((s,c)=>{
    const folder=folders.find(f=>f.name===c[3]);
    const original=(folder?.changes||[]).find(x=>x.path===c[2]&&x.type===c[0]);
    return s+(original?.size||0);
  },0);
  const boxes=document.querySelectorAll('.stat-grid strong');
  boxes[0].textContent=total; boxes[1].textContent=formatSize(bytes); boxes[2].textContent='—';
  const donut=document.querySelector('.donut span');
  if(donut) donut.innerHTML=`${total}<small>files</small>`;
}

async function loadStatus(scan=false) {
  const toast=document.getElementById('toast');
  try {
    if(scan){ toast.textContent='Scanning folders…'; toast.classList.add('show'); }
    const res=await fetch(scan?'/api/scan':'/api/status',{method:scan?'POST':'GET'});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json(); folders=data.folders||[];
    collectChanges(); renderFolders(); renderChanges('all'); updateStats();
    if(scan){ toast.textContent='Scan complete · '+data.scan_time; setTimeout(()=>toast.classList.remove('show'),2200); }
  } catch(err) {
    toast.textContent='Backaris backend not running. Start: python3 backaris.py';
    toast.classList.add('show');
  }
}

document.querySelectorAll('.chip').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));
  button.classList.add('active'); renderChanges(button.dataset.type);
}));

const chart=document.getElementById('barChart');
[30,18,24,42,60,75,90,70,52,45,67,56,73,95,62,48,37,30,34,38,42,58,69,75,66,80,48,61,79,79].forEach(h=>{
  const bar=document.createElement('i'); bar.style.height=h+'%'; chart.appendChild(bar);
});

document.getElementById('backupButton').textContent='⟳ Scan Folders Now';
document.getElementById('backupButton').addEventListener('click',()=>loadStatus(true));
async function loadUsbStatus() {
  try {
    const res=await fetch('/api/usb');
    const data=await res.json();
    const dot=document.querySelector('.status-dot');
    const name=document.getElementById('usbName');
    const details=document.getElementById('usbDetails');
    const meta=document.getElementById('usbMeta');
    const drives=data.drives||[];
    if(drives.length) {
      const d=drives[0];
      dot.style.background='#00efc3';
      dot.style.boxShadow='0 0 12px #00efc3';
      name.textContent=d.label;
      details.textContent=`${d.mountpoint} · ${d.free_text||'?'} free of ${d.capacity_text||'?'}`;
      meta.textContent=`${d.filesystem||'filesystem ?'} · UUID ${d.uuid||'not available'}${drives.length>1?' · '+drives.length+' USB drives detected':''}`;
    } else {
      dot.style.background='#5b7184'; dot.style.boxShadow='none';
      name.textContent='No USB backup drive';
      details.textContent='Waiting for a removable drive…';
      meta.textContent=data.error ? 'Detection error: '+data.error : 'Detection only · nothing will be written';
    }
  } catch(err) {}
}
const USB_SCAN_SECONDS=60;
let usbSecondsLeft=USB_SCAN_SECONDS;

function resetUsbScanner() {
  usbSecondsLeft=USB_SCAN_SECONDS;
  document.getElementById('usbScanFill').style.width='0%';
}

function tickUsbScanner() {
  usbSecondsLeft--;
  const progress=((USB_SCAN_SECONDS-usbSecondsLeft)/USB_SCAN_SECONDS)*100;
  document.getElementById('usbScanFill').style.width=progress+'%';
  document.getElementById('usbCountdown').textContent='SCAN IN '+usbSecondsLeft+'s';
  if(usbSecondsLeft<=0) {
    const pulse=document.getElementById('usbScanPulse');
    pulse.classList.remove('fire'); void pulse.offsetWidth; pulse.classList.add('fire');
    loadUsbStatus();
    resetUsbScanner();
  }
}

document.getElementById('usbScanner').addEventListener('click',()=>{
  const pulse=document.getElementById('usbScanPulse');
  pulse.classList.remove('fire'); void pulse.offsetWidth; pulse.classList.add('fire');
  loadUsbStatus();
  resetUsbScanner();
});

loadStatus(false);
loadUsbStatus();
resetUsbScanner();
setInterval(tickUsbScanner, 1000);
