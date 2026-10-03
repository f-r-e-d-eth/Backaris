let folders = [];
let changes = [];
let backupDevices = [];
let historicalChanges = [];
let changePeriod = '7';
const colors = ['#00e0ff','#8a4dff','#ff2ec4','#ffd84d','#00efc3'];

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units=['B','KB','MB','GB','TB']; let v=bytes, i=0;
  while(v>=1024 && i<units.length-1){v/=1024;i++;}
  return (i<2 ? Math.round(v) : v.toFixed(1))+' '+units[i];
}

function toast(message, ms=3000) {
  const host=document.getElementById('toast');
  host.textContent=message; host.classList.add('show');
  if(ms) setTimeout(()=>host.classList.remove('show'),ms);
}

function renderFolders() {
  const host=document.getElementById('folderRows'); host.innerHTML='';
  folders.forEach((f,index)=>{
    const row=document.createElement('div'); row.className='folder-row';
    const total=(f.new||0)+(f.modified||0)+(f.deleted||0);
    const detail=f.baseline ? `+${f.new} / ~${f.modified} / -${f.deleted}` : 'baseline created';
    const sizes=(f.history||[]).map(h=>h.total_size);
    let heights=[14];
    if(sizes.length>1){
      const min=Math.min(...sizes), max=Math.max(...sizes), range=Math.max(max-min,1);
      heights=sizes.map(v=>6+Math.round(((v-min)/range)*22));
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
  folders.forEach(f=>(f.changes||[]).forEach(c=>changes.push([
    c.type, c.type==='new'?'+':c.type==='modified'?'~':'−',
    c.path, f.name, 'since backup', formatSize(c.size)
  ])));
}

function renderChanges(type='all') {
  const source=changePeriod==='current' ? changes : historicalChanges;
  const host=document.getElementById('changeRows'); host.innerHTML='';
  source.filter(c=>type==='all'||c[0]===type).slice(0,100).forEach(c=>{
    const row=document.createElement('div'); row.className='change-row';
    row.innerHTML=`<span class="type-${c[0]}"><b>${c[1]}</b></span><span>${c[2]}</span><span>${c[3]}</span><span>${c[4]}</span><span>${c[5]}</span>`;
    host.appendChild(row);
  });
  if(!host.children.length) host.innerHTML='<div class="restore-empty">No changes in this view.</div>';
  const counts={new:0,modified:0,deleted:0};
  source.forEach(c=>counts[c[0]] += changePeriod==='current' ? 1 : (parseInt(c[5])||0));
  ['new','modified','deleted'].forEach(kind=>{
    const button=document.querySelector('[data-type="'+kind+'"]');
    button.textContent=kind[0].toUpperCase()+kind.slice(1)+' ('+counts[kind]+')';
  });
}

async function loadRecentChanges(period=changePeriod) {
  changePeriod=period;
  if(period==='current') { historicalChanges=[]; renderChanges(document.querySelector('.chip.active')?.dataset.type||'all'); return; }
  try {
    const response=await fetch('/api/change-history?days='+encodeURIComponent(period));
    const data=await response.json();
    historicalChanges=[];
    (data.rows||[]).forEach(row=>{
      const folder=folders.find(f=>f.path===row.folder_path);
      const folderName=folder?.name||row.folder_path;
      [['new','+','New'],['modified','~','Modified'],['deleted','−','Deleted']].forEach(([type,symbol,label])=>{
        const count=row[type+'_count']||0;
        if(count) historicalChanges.push([type,symbol,label+' files',folderName,row.day,count+' files']);
      });
    });
    renderChanges(document.querySelector('.chip.active')?.dataset.type||'all');
  } catch(err) { toast('Could not load change history · '+err.message); }
}

async function loadStatistics() {
  try {
    const response=await fetch('/api/statistics?days=30');
    const data=await response.json();
    const history=data.history||[], totals=data.changes||{new:0,modified:0,deleted:0};
    const total=(totals.new||0)+(totals.modified||0)+(totals.deleted||0);
    document.getElementById('statChanges').textContent=total;
    document.getElementById('statStorage').textContent=formatSize(data.latest_total_size||0);
    document.getElementById('statFiles').textContent=data.latest_file_count||0;
    document.getElementById('legendNew').textContent=totals.new||0;
    document.getElementById('legendModified').textContent=totals.modified||0;
    document.getElementById('legendDeleted').textContent=totals.deleted||0;
    const donut=document.querySelector('.donut'), donutText=donut.querySelector('span');
    donutText.innerHTML=total+'<small>changes</small>';
    if(total){
      const a=(totals.new/total)*100, b=a+(totals.modified/total)*100;
      donut.style.background=`conic-gradient(var(--cyan) 0 ${a}%, var(--purple) ${a}% ${b}%, var(--pink) ${b}% 100%)`;
    } else donut.style.background='rgba(0,224,255,.12)';
    const chart=document.getElementById('barChart'); chart.innerHTML='';
    const max=Math.max(...history.map(h=>h.total_size||0),1);
    history.forEach(h=>{
      const bar=document.createElement('i');
      bar.style.height=Math.max(3,Math.round((h.total_size/max)*100))+'%';
      bar.title=h.day+' · '+formatSize(h.total_size);
      chart.appendChild(bar);
    });
    if(!history.length) chart.innerHTML='<span class="chart-empty">Statistics appear after the first manual scan.</span>';
  } catch(err) {}
}

async function loadStatus(scan=false) {
  try {
    if(scan) toast('Scanning folders…',0);
    const response=await fetch(scan?'/api/scan':'/api/status',{method:scan?'POST':'GET'});
    if(!response.ok) throw new Error('HTTP '+response.status);
    const data=await response.json(); folders=data.folders||[];
    collectChanges(); renderFolders();
    await loadRecentChanges(changePeriod); await loadStatistics();
    if(scan) toast('Scan complete · '+data.scan_time);
  } catch(err) { toast('Backaris backend not running. Start: python3 backaris.py',0); }
}

document.querySelectorAll('.chip').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));
  button.classList.add('active'); renderChanges(button.dataset.type);
}));
document.getElementById('changeFilter').addEventListener('change',event=>loadRecentChanges(event.target.value));
document.getElementById('scanButton').addEventListener('click',async()=>{
  const button=document.getElementById('scanButton');
  button.disabled=true; button.textContent='◷ Scanning…';
  await loadStatus(true);
  button.disabled=false; button.textContent='⟳ Scan Folders';
});

document.getElementById('backupButton').addEventListener('click',async()=>{
  const ready=backupDevices.filter(d=>d.is_backaris && d.borg_repository?.initialized);
  if(!ready.length) return alert('Connect a recognized Backaris device with an initialized Borg repository.');
  let device=ready[0];
  if(ready.length>1){
    const choice=prompt('Backup device ID:\n'+ready.map(d=>d.backaris_id+' — '+d.backaris_name).join('\n'),ready[0].backaris_id);
    device=ready.find(d=>d.backaris_id===choice); if(!device) return;
  }
  if(!confirm('Create a real backup on '+device.backaris_name+'?')) return;
  const button=document.getElementById('backupButton');
  button.disabled=true; button.textContent='◷ Backup running…';
  toast('Borg backup running · do not remove the USB drive',0);
  try {
    const response=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:device.backaris_id})});
    const result=await response.json();
    if(!response.ok||!result.ok) throw new Error(result.error||'Backup failed');
    toast('Backup complete · '+result.archive+' · '+result.duration_seconds+' s',6000);
    await loadStatus(false); await loadUsbStatus();
  } catch(err) { toast('BACKUP FAILED · '+err.message,6000); }
  finally { button.disabled=false; button.textContent='▷ Start Backup Now'; }
});

async function loadUsbStatus() {
  try {
    const response=await fetch('/api/usb'), data=await response.json();
    backupDevices=data.drives||[];
    const borg=data.borg||{}, borgHost=document.getElementById('borgStatus');
    borgHost.className='borg-status '+(borg.installed?'ready':'dim');
    borgHost.textContent=borg.installed?'BORG · '+borg.version+' · READY':'BORG · NOT INSTALLED';
    document.getElementById('appStatus').textContent='V1.0 RC · '+(borg.installed?'Borg ready':'Borg missing');
    const host=document.getElementById('usbDriveList');
    if(!backupDevices.length){
      host.innerHTML=`<div class="drive-status dim"><span class="status-dot"></span><div><strong>No USB drive</strong><p>Waiting for a removable drive…</p><small>${data.error?'Detection error: '+data.error:'Detection only · nothing will be written'}</small></div></div>`;
      return;
    }
    host.innerHTML=backupDevices.map(d=>{
      const backup=d.is_backaris, title=backup?d.backaris_name:d.label;
      const tag=backup?'BACKARIS BACKUP · '+d.backaris_id:'USB DRIVE · NOT A BACKARIS BACKUP';
      const repo=d.borg_repository;
      const repoLine=backup?(repo?.initialized?'<button class="repo-badge ready" disabled>BORG REPOSITORY READY</button>':'<button class="repo-badge init" data-device="'+d.backaris_id+'">INITIALIZE BORG REPOSITORY</button>'):'';
      return `<div class="drive-status ${backup?'backup':'dim'}"><span class="status-dot"></span><div><strong>${title}</strong><p>${d.mountpoint} · ${d.free_text||'?'} free of ${d.capacity_text||'?'}</p><small>${tag} · ${d.filesystem||'filesystem ?'}${d.device_error?' · '+d.device_error:''}</small>${repoLine}</div></div>`;
    }).join('');
    host.querySelectorAll('.repo-badge.init').forEach(button=>button.addEventListener('click',async()=>{
      if(!confirm('Initialize a new unencrypted Borg repository on this Backaris device?')) return;
      toast('Initializing Borg repository…',0);
      try {
        const response=await fetch('/api/borg/init',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:button.dataset.device})});
        const result=await response.json();
        toast(result.ok?'Borg repository initialized.':'Borg init failed: '+result.error);
        if(result.ok) loadUsbStatus();
      } catch(err){ toast('Borg init failed: '+err); }
    }));
  } catch(err) {}
}

const USB_SCAN_SECONDS=60;
let usbSecondsLeft=USB_SCAN_SECONDS;
function resetUsbScanner(){usbSecondsLeft=USB_SCAN_SECONDS;document.getElementById('usbScanFill').style.width='0%';}
function tickUsbScanner(){
  usbSecondsLeft--;
  document.getElementById('usbScanFill').style.width=((USB_SCAN_SECONDS-usbSecondsLeft)/USB_SCAN_SECONDS)*100+'%';
  document.getElementById('usbCountdown').textContent='SCAN IN '+usbSecondsLeft+'s';
  if(usbSecondsLeft<=0){pulseUsb();loadUsbStatus();resetUsbScanner();}
}
function pulseUsb(){const p=document.getElementById('usbScanPulse');p.classList.remove('fire');void p.offsetWidth;p.classList.add('fire');}
document.getElementById('usbScanner').addEventListener('click',()=>{pulseUsb();loadUsbStatus();resetUsbScanner();});

let restoreFilesCache=[];
function showView(name){
  const restore=name==='restore';
  document.getElementById('overviewView').classList.toggle('hidden',restore);
  document.getElementById('restoreView').classList.toggle('hidden',!restore);
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  document.getElementById('viewTitle').textContent=restore?'RESTORE':'OVERVIEW';
  document.getElementById('viewSubtitle').textContent=restore?'Browse a Borg snapshot and rescue a file without touching the original.':'Your folders, their status and recent changes.';
  if(restore) loadRestoreDevices();
}
document.querySelectorAll('.nav-item[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));

function loadRestoreDevices(){
  const select=document.getElementById('restoreDevice');
  const ready=backupDevices.filter(d=>d.is_backaris&&d.borg_repository?.initialized);
  select.innerHTML=ready.length?ready.map(d=>'<option value="'+d.backaris_id+'">'+d.backaris_name+'</option>').join(''):'<option value="">No backup device connected</option>';
  if(ready.length) loadRestoreArchives();
}
async function loadRestoreArchives(){
  const device=document.getElementById('restoreDevice').value, archive=document.getElementById('restoreArchive'), files=document.getElementById('restoreFiles');
  if(!device)return;
  archive.innerHTML='<option>Loading snapshots…</option>'; files.innerHTML='<div class="restore-empty">Reading Borg repository…</div>';
  try{
    const response=await fetch('/api/restore/archives?device_id='+encodeURIComponent(device)), data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Could not list snapshots');
    const archives=(data.archives||[]).slice().reverse();
    archive.innerHTML=archives.length?archives.map(a=>'<option value="'+a.name+'">'+a.name+'</option>').join(''):'<option value="">No snapshots found</option>';
    if(archives.length)loadRestoreFiles();else files.innerHTML='<div class="restore-empty">No snapshots found.</div>';
  }catch(err){archive.innerHTML='<option value="">Error</option>';files.innerHTML='<div class="restore-empty">'+err.message+'</div>';}
}
async function loadRestoreFiles(){
  const device=document.getElementById('restoreDevice').value, archive=document.getElementById('restoreArchive').value, host=document.getElementById('restoreFiles');
  if(!device||!archive)return;
  host.innerHTML='<div class="restore-empty">Reading file list…</div>';
  try{
    const response=await fetch('/api/restore/files?device_id='+encodeURIComponent(device)+'&archive='+encodeURIComponent(archive)), data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Could not list files');
    restoreFilesCache=data.files||[];renderRestoreFiles();
  }catch(err){host.innerHTML='<div class="restore-empty">'+err.message+'</div>';}
}
function renderRestoreFiles(){
  const host=document.getElementById('restoreFiles'), query=document.getElementById('restoreSearch').value.toLowerCase();
  const visible=restoreFilesCache.filter(f=>f.path.toLowerCase().includes(query));
  document.getElementById('restoreCount').textContent=visible.length+' files';
  host.innerHTML=visible.slice(0,1000).map(f=>'<button class="restore-file" data-path="'+encodeURIComponent(f.path)+'"><span>▱ '+f.path+'</span><small>'+formatSize(f.size)+'</small></button>').join('')||'<div class="restore-empty">No matching files.</div>';
  host.querySelectorAll('.restore-file').forEach(button=>button.addEventListener('click',()=>restoreFile(decodeURIComponent(button.dataset.path))));
}
async function restoreFile(path){
  const device=document.getElementById('restoreDevice').value, archive=document.getElementById('restoreArchive').value;
  if(!confirm('Restore this file to ~/Backaris-Restore?\n\n'+path+'\n\nThe original file will not be touched.'))return;
  toast('Restoring '+path+'…',0);
  try{
    const response=await fetch('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:device,archive,path})}), data=await response.json();
    if(!response.ok||!data.ok)throw new Error(data.error||'Restore failed');
    toast('RESCUED · '+data.restored_to,8000);
  }catch(err){toast('RESTORE FAILED · '+err.message,8000);}
}
document.getElementById('restoreDevice').addEventListener('change',loadRestoreArchives);
document.getElementById('restoreArchive').addEventListener('change',loadRestoreFiles);
document.getElementById('restoreSearch').addEventListener('input',renderRestoreFiles);

loadStatus(false);
loadUsbStatus();
resetUsbScanner();
setInterval(tickUsbScanner,1000);
