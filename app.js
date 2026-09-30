let folders = [];
let changes = [];
let backupDevices = [];
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

document.getElementById('backupButton').textContent='▷ Start Backup Now';
document.getElementById('backupButton').addEventListener('click',async()=>{
  const ready=backupDevices.filter(d=>d.is_backaris && d.borg_repository?.initialized);
  if(!ready.length) {
    alert('Connect a recognized Backaris device with an initialized Borg repository.');
    return;
  }
  let device=ready[0];
  if(ready.length>1) {
    const choice=prompt('Backup device ID:\n'+ready.map(d=>d.backaris_id+' — '+d.backaris_name).join('\n'),ready[0].backaris_id);
    device=ready.find(d=>d.backaris_id===choice);
    if(!device) return;
  }
  if(!confirm('Create a real backup on '+device.backaris_name+'?')) return;
  const button=document.getElementById('backupButton');
  const toast=document.getElementById('toast');
  button.disabled=true; button.textContent='◷ Backup running…';
  toast.textContent='Borg backup running · do not remove the USB drive'; toast.classList.add('show');
  try {
    const response=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:device.backaris_id})});
    const result=await response.json();
    if(!response.ok || !result.ok) throw new Error(result.error||'Backup failed');
    toast.textContent='Backup complete · '+result.archive+' · '+result.duration_seconds+' s';
    await loadStatus(false); await loadUsbStatus();
  } catch(err) {
    toast.textContent='BACKUP FAILED · '+err.message;
  } finally {
    button.disabled=false; button.textContent='▷ Start Backup Now';
    setTimeout(()=>toast.classList.remove('show'),6000);
  }
});
async function loadUsbStatus() {
  try {
    const res=await fetch('/api/usb');
    const data=await res.json();
    const host=document.getElementById('usbDriveList');
    const drives=data.drives||[];
    backupDevices=drives;
    const borg=data.borg||{};
    const borgHost=document.getElementById('borgStatus');
    borgHost.className='borg-status '+(borg.installed?'ready':'dim');
    borgHost.textContent=borg.installed ? 'BORG · '+borg.version+' · READY' : 'BORG · NOT INSTALLED';
    if(!drives.length) {
      host.innerHTML=`<div class="drive-status dim"><span class="status-dot"></span><div>
        <strong>No USB drive</strong><p>Waiting for a removable drive…</p>
        <small>${data.error ? 'Detection error: '+data.error : 'Detection only · nothing will be written'}</small>
      </div></div>`;
      return;
    }
    host.innerHTML=drives.map(d=>{
      const backup=d.is_backaris;
      const title=backup ? d.backaris_name : d.label;
      const tag=backup ? 'BACKARIS BACKUP · '+d.backaris_id : 'USB DRIVE · NOT A BACKARIS BACKUP';
      const warning=d.device_error ? ' · '+d.device_error : '';
      const repo=d.borg_repository;
      const repoLine=backup ? (repo?.initialized
        ? '<button class="repo-badge ready" disabled>BORG REPOSITORY READY</button>'
        : '<button class="repo-badge init" data-device="'+d.backaris_id+'">INITIALIZE BORG REPOSITORY</button>') : '';
      return `<div class="drive-status ${backup?'backup':'dim'}">
        <span class="status-dot"></span><div>
          <strong>${title}</strong>
          <p>${d.mountpoint} · ${d.free_text||'?'} free of ${d.capacity_text||'?'}</p>
          <small>${tag} · ${d.filesystem||'filesystem ?'}${warning}</small>
          ${repoLine}
        </div>
      </div>`;
    }).join('');
    host.querySelectorAll('.repo-badge.init').forEach(button=>button.addEventListener('click',async()=>{
      if(!confirm('Initialize a new unencrypted Borg repository on this Backaris device?')) return;
      const toast=document.getElementById('toast');
      toast.textContent='Initializing Borg repository…'; toast.classList.add('show');
      try {
        const response=await fetch('/api/borg/init',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:button.dataset.device})});
        const result=await response.json();
        toast.textContent=result.ok ? 'Borg repository initialized.' : 'Borg init failed: '+result.error;
        if(result.ok) loadUsbStatus();
      } catch(err) { toast.textContent='Borg init failed: '+err; }
      setTimeout(()=>toast.classList.remove('show'),3500);
    }));
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
