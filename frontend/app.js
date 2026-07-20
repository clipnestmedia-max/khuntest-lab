
const K={patients:'kt_patients',session:'kt_session',bookings:'kt_bookings',tests:'kt_tests',packages:'kt_packages',payments:'kt_payments',staff:'kt_staff',notifications:'kt_notifications'};
function normPatientName(v){return String(v||'').trim().replace(/\s+/g,' ').toUpperCase()}
const defaultTests=[{id:'CBC',name:'CBC Blood Test',price:399,category:'Blood Test',time:'Same Day'},{id:'THY',name:'Thyroid Profile',price:699,category:'Hormone',time:'24 Hours'},{id:'LIP',name:'Lipid Profile',price:799,category:'Heart Health',time:'24 Hours'},{id:'DIA',name:'Diabetes Test',price:499,category:'Diabetes',time:'Same Day'},{id:'VDB',name:'Vitamin D/B12',price:1299,category:'Vitamin',time:'24 Hours'},{id:'FBC',name:'Full Body Checkup',price:1999,category:'Package',time:'24-48 Hours'},{id:'LFT',name:'Liver Function Test',price:899,category:'Organ Profile',time:'24 Hours'},{id:'KFT',name:'Kidney Function Test',price:899,category:'Organ Profile',time:'24 Hours'}];
const defaultPackages=[{id:'PK1',name:'Basic Health Checkup',price:999,tests:['CBC','Blood Sugar','Lipid Basic']},{id:'PK2',name:'Full Body Checkup',price:1999,tests:['CBC','Thyroid','LFT','KFT','Lipid Profile']},{id:'PK3',name:'Senior Citizen Package',price:2499,tests:['Diabetes','Kidney/Liver','Vitamin','Heart Profile']}];
const defaultStaff=[{id:'ST1',name:'Ravi Kumar',phone:'9234277007',area:'Darbhanga'},{id:'ST2',name:'Amit Jha',phone:'9234277007',area:'Laheriasarai'}];
function get(k,f){return JSON.parse(localStorage.getItem(k)||JSON.stringify(f))}function set(k,v){localStorage.setItem(k,JSON.stringify(v))}function uid(p='KT'){return p+Date.now().toString().slice(-6)+Math.floor(Math.random()*90+10)}function money(n){return '₹'+Number(n||0).toLocaleString('en-IN')}function cls(s){return String(s||'pending').toLowerCase().replaceAll(' ','')}
function init(){if(!localStorage.getItem(K.tests))set(K.tests,defaultTests);if(!localStorage.getItem(K.packages))set(K.packages,defaultPackages);if(!localStorage.getItem(K.staff))set(K.staff,defaultStaff);if(!localStorage.getItem(K.bookings))set(K.bookings,[{id:'KTB1001',patientName:'DEMO PATIENT',age:'28',gender:'Male',phone:'9234277007',email:'demo@patient.com',test:'Full Body Checkup',price:1999,bookingType:'Home Collection',date:'2026-06-05',time:'09:00',address:'Allalpatti, Laheriasarai, Darbhanga, Bihar',status:'Confirmed',payment:'Paid',staff:'Ravi Kumar',createdAt:new Date().toISOString(),reportReleased:false,reportBillNo:''}]);if(!localStorage.getItem(K.payments))set(K.payments,[]);if(!localStorage.getItem(K.notifications))set(K.notifications,[])}init();
function showMsg(id,cl,msg){const e=document.getElementById(id);if(!e)return;e.className=cl;e.textContent=msg;e.classList.remove('hidden')}function logout(){localStorage.removeItem(K.session);location.href='index.html'}function setTab(t){document.querySelectorAll('[data-panel]').forEach(p=>p.classList.add('hidden'));document.querySelectorAll('[data-tab]').forEach(b=>b.classList.remove('active'));document.querySelector(`[data-panel="${t}"]`)?.classList.remove('hidden');document.querySelector(`[data-tab="${t}"]`)?.classList.add('active')}
function populateTestSelect(id){const sel=document.getElementById(id);if(!sel)return;let items=[...get(K.tests,defaultTests),...get(K.packages,defaultPackages).map(p=>({id:p.id,name:p.name,price:p.price,category:'Package',time:'24-48 Hours'}))];sel.innerHTML='<option value="">Select Test / Package</option>'+items.map(t=>`<option value="${t.name}" data-price="${t.price}">${t.name} - ${money(t.price)}</option>`).join('')}
function bookTest(e){e.preventDefault();const f=e.target;const opt=f.test.options[f.test.selectedIndex];const price=Number(opt?.dataset?.price||0);const booking={id:uid('KTB'),patientName:normPatientName(f.patientName.value),age:f.age.value,gender:f.gender.value,phone:f.phone.value.trim(),email:f.email.value.trim(),test:f.test.value,price,bookingType:f.bookingType.value,date:f.date.value,time:f.time.value,address:f.address.value.trim(),status:'Pending',payment:f.payment.value,staff:'Not Assigned',createdAt:new Date().toISOString(),reportReleased:false,reportBillNo:''};let bs=get(K.bookings,[]);bs.unshift(booking);set(K.bookings,bs);let pays=get(K.payments,[]);pays.unshift({id:uid('PAY'),bookingId:booking.id,email:booking.email,amount:price,mode:booking.payment,status:booking.payment.includes('Online')?'Demo Paid':'Pending',date:new Date().toISOString()});set(K.payments,pays);addNotification('New booking received: '+booking.id);showMsg('bookingMsg','success',`Booking successful. Your Booking ID is ${booking.id}. Login with same email to track reports.`);f.reset();}
function registerPatient(e){e.preventDefault();const f=e.target;let ps=get(K.patients,[]);if(ps.find(p=>p.email===f.email.value.trim())){showMsg('authMsg','error','This email is already registered. Please login.');return}const p={id:uid('PT'),name:normPatientName(f.name.value),phone:f.phone.value.trim(),email:f.email.value.trim(),password:f.password.value,address:f.address?.value||''};ps.push(p);set(K.patients,ps);localStorage.setItem(K.session,JSON.stringify({type:'patient',email:p.email,name:p.name}));location.href='patient-dashboard.html'}
function loginPatient(e){e.preventDefault();const f=e.target;const p=get(K.patients,[]).find(x=>x.email===f.email.value.trim()&&x.password===f.password.value);if(!p){showMsg('authMsg','error','Invalid patient email or password. Register first if new patient.');return}localStorage.setItem(K.session,JSON.stringify({type:'patient',email:p.email,name:p.name}));location.href='patient-dashboard.html'}
function loginAdmin(e){e.preventDefault();const f=e.target;if(f.email.value.trim()==='admin@khuntest.com'&&f.password.value==='admin123'){localStorage.setItem(K.session,JSON.stringify({type:'admin',email:'admin@khuntest.com',name:'Admin'}));location.href='admin-dashboard.html'}else showMsg('authMsg','error','Invalid admin login. Use admin@khuntest.com / admin123')}
function requireSession(type){const s=JSON.parse(localStorage.getItem(K.session)||'null');if(!s||s.type!==type)location.href=type==='admin'?'admin-login.html':'patient-login.html';return s}
function patientDashboard(){const s=requireSession('patient');document.getElementById('patientName').textContent=normPatientName(s.name);const bs=get(K.bookings,[]).filter(b=>b.email===s.email);const ps=get(K.patients,[]);const p=ps.find(x=>x.email===s.email)||{};['profileName','profileEmail','profilePhone','profileAddress'].forEach(id=>{const el=document.getElementById(id); if(el){const key=id.replace('profile','').toLowerCase(); el.value= key==='name'?normPatientName(s.name):key==='email'?s.email:(p[key]||'')}});renderPatient(bs)}
function renderPatient(bs){document.getElementById('patientBookings').innerHTML=bs.length?bs.map(b=>`<tr><td><b>${b.id}</b><br><small>${new Date(b.createdAt).toLocaleDateString()}</small></td><td>${b.test}<br><small>${b.bookingType}</small></td><td>${b.date} ${b.time}</td><td><span class="status ${cls(b.status)}">${b.status}</span></td><td>${money(b.price)}</td></tr>`).join(''):'<tr><td colspan="5">No bookings found.</td></tr>';document.getElementById('patientReports').innerHTML=bs.length?bs.map(b=>{const bill=b.reportBillNo||b.billNo||b.id;return `<tr><td><b>${b.id}</b></td><td>${b.test}</td><td><span class="status ${cls(b.status)}">${b.status}</span></td><td>${b.reportReleased?`<a class="report-link" target="_blank" href="report.html?bill=${encodeURIComponent(bill)}">View Report</a>`:'Report not released yet'}</td></tr>`}).join(''):'<tr><td colspan="4">No reports.</td></tr>';const pays=get(K.payments,[]).filter(p=>bs.some(b=>b.id===p.bookingId));document.getElementById('patientReceipts').innerHTML=pays.length?pays.map(p=>`<tr><td>${p.id}</td><td>${p.bookingId}</td><td>${money(p.amount)}</td><td>${p.mode}</td><td>${p.status}</td></tr>`).join(''):'<tr><td colspan="5">No payment history.</td></tr>'}
function updateProfile(e){e.preventDefault();const s=requireSession('patient');let ps=get(K.patients,[]);let p=ps.find(x=>x.email===s.email);if(p){p.name=normPatientName(document.getElementById('profileName').value);p.phone=document.getElementById('profilePhone').value;p.address=document.getElementById('profileAddress').value;set(K.patients,ps);localStorage.setItem(K.session,JSON.stringify({...s,name:p.name}));showMsg('profileMsg','success','Profile updated successfully.')}}
function adminDashboard(){requireSession('admin');renderMetrics();renderBookings();renderTests();renderStaff();renderPackages();renderNotifications()}
function renderMetrics(){const bs=get(K.bookings,[]), total=bs.reduce((s,b)=>s+Number(b.price||0),0);document.getElementById('mBookings').textContent=bs.length;document.getElementById('mRevenue').textContent=money(total);document.getElementById('mPatients').textContent=new Set(bs.map(b=>b.email)).size;document.getElementById('mReports').textContent=bs.filter(b=>b.reportReleased).length}
function renderBookings(){const bs=get(K.bookings,[]), staffs=get(K.staff,[]);document.getElementById('adminBookings').innerHTML=bs.map(b=>{const bill=b.reportBillNo||b.billNo||b.id;return `<tr><td><b>${b.id}</b><br><small>${new Date(b.createdAt).toLocaleString()}</small></td><td>${normPatientName(b.patientName)}<br><small>${b.age||''} ${b.gender||''}<br>${b.phone}<br>${b.email}</small></td><td>${b.test}<br><b>${money(b.price)}</b></td><td>${b.bookingType}<br><small>${b.date} ${b.time}</small><br><small>${b.address}</small></td><td><select onchange="updateBooking('${b.id}','status',this.value)">${['Pending','Confirmed','Collected','Reported','Cancelled'].map(x=>`<option ${b.status===x?'selected':''}>${x}</option>`).join('')}</select></td><td><select onchange="updateBooking('${b.id}','staff',this.value)"><option>Not Assigned</option>${staffs.map(s=>`<option ${b.staff===s.name?'selected':''}>${s.name}</option>`).join('')}</select></td><td><input type="file" accept="application/pdf,image/*" onchange="uploadReport('${b.id}',this)">${b.reportReleased?`<a class="report-link" target="_blank" href="report.html?bill=${encodeURIComponent(bill)}">View Report</a> <a class="report-link" target="_blank" href="report.html?bill=${encodeURIComponent(bill)}">Print Report</a>`:''}</td></tr>`}).join('')}
function updateBooking(id,field,value){let bs=get(K.bookings,[]);let b=bs.find(x=>x.id===id);if(b){b[field]=value;set(K.bookings,bs);addNotification(`${field} updated for ${id}: ${value}`);renderMetrics()}}
function uploadReport(id,input){const file=input.files[0];if(!file)return;const r=new FileReader();r.onload=()=>{let bs=get(K.bookings,[]);let b=bs.find(x=>x.id===id);if(b){b.externalReportName=file.name;b.externalReportData=r.result;b.reportReleased=true;b.reportBillNo=b.billNo||b.id;b.status='Reported';set(K.bookings,bs);addNotification('Report uploaded for '+id);renderBookings();renderMetrics();alert('Report uploaded. View Report opens the A4 report page when bill data exists.')}};r.readAsDataURL(file)}
function renderTests(){const body=document.getElementById('testsBody');if(!body)return;body.innerHTML=get(K.tests,[]).map(t=>`<tr><td><b>${t.name}</b><br><small>${t.category}</small></td><td>${money(t.price)}</td><td>${t.time}</td><td><button class="btn btn-outline btn-small" onclick="deleteTest('${t.id}')">Delete</button></td></tr>`).join('')}
function addTest(e){e.preventDefault();const f=e.target;let tests=get(K.tests,[]);tests.push({id:uid('T'),name:f.name.value,price:Number(f.price.value),category:f.category.value,time:f.time.value});set(K.tests,tests);f.reset();renderTests();populateTestSelect('testSelect')}
function deleteTest(id){set(K.tests,get(K.tests,[]).filter(t=>t.id!==id));renderTests()}
function renderPackages(){const body=document.getElementById('packagesBody');if(!body)return;body.innerHTML=get(K.packages,[]).map(p=>`<tr><td><b>${p.name}</b><br><small>${p.tests.join(', ')}</small></td><td>${money(p.price)}</td><td><button class="btn btn-outline btn-small" onclick="deletePackage('${p.id}')">Delete</button></td></tr>`).join('')}
function addPackage(e){e.preventDefault();const f=e.target;let pk=get(K.packages,[]);pk.push({id:uid('PK'),name:f.name.value,price:Number(f.price.value),tests:f.tests.value.split(',').map(x=>x.trim())});set(K.packages,pk);f.reset();renderPackages()}
function deletePackage(id){set(K.packages,get(K.packages,[]).filter(p=>p.id!==id));renderPackages()}
function renderStaff(){const body=document.getElementById('staffBody');if(!body)return;body.innerHTML=get(K.staff,[]).map(s=>`<tr><td><b>${s.name}</b></td><td>${s.phone}</td><td>${s.area}</td><td><button class="btn btn-outline btn-small" onclick="deleteStaff('${s.id}')">Delete</button></td></tr>`).join('')}
function addStaff(e){e.preventDefault();const f=e.target;let st=get(K.staff,[]);st.push({id:uid('ST'),name:f.name.value,phone:f.phone.value,area:f.area.value});set(K.staff,st);f.reset();renderStaff();renderBookings()}
function deleteStaff(id){set(K.staff,get(K.staff,[]).filter(s=>s.id!==id));renderStaff();renderBookings()}
function addNotification(msg){let n=get(K.notifications,[]);n.unshift({id:uid('N'),msg,date:new Date().toISOString()});set(K.notifications,n)}
function renderNotifications(){const body=document.getElementById('notifyBody');if(!body)return;body.innerHTML=get(K.notifications,[]).map(n=>`<tr><td>${n.msg}</td><td>${new Date(n.date).toLocaleString()}</td></tr>`).join('')||'<tr><td colspan="2">No notifications yet.</td></tr>'}
function filterAdminBookings(){const q=document.getElementById('bookingSearch').value.toLowerCase();document.querySelectorAll('#adminBookings tr').forEach(r=>r.style.display=r.innerText.toLowerCase().includes(q)?'':'none')}
document.addEventListener('DOMContentLoaded',()=>populateTestSelect('testSelect'));


// ===== KHUNTEST LABS advanced Patient Entry + Report Generate module =====
const ktReportCatalog = [
  {id:'CBC', name:'CBC', price:400, rebate:100, lab:90, normal:'', unit:'', defaultFinding:''},
  {id:'CBCS', name:'CBC+COMMENT OF SMEAR', price:700, rebate:150, lab:300, normal:'', unit:'', defaultFinding:''},
  {id:'BSR', name:'Blood Sugar (Random)', price:120, rebate:80, lab:60, normal:'74-140', unit:'mg/dl', defaultFinding:'81.4'},
  {id:'LFT', name:'LIVER FUNCTION TEST', price:800, rebate:500, lab:350, normal:'', unit:'', defaultFinding:''},
  {id:'IGE', name:'SERUM IgE', price:700, rebate:500, lab:350, normal:'00-200', unit:'U/L', defaultFinding:'1200'},
  {id:'KFT', name:'KFT', price:800, rebate:500, lab:350, normal:'', unit:'', defaultFinding:''},
  {id:'THY', name:'Thyroid Profile', price:700, rebate:450, lab:300, normal:'TSH: 0.4-4.0', unit:'mIU/L', defaultFinding:''},
  {id:'LIPID', name:'Lipid Profile', price:800, rebate:550, lab:350, normal:'Cholesterol <200', unit:'mg/dl', defaultFinding:''},
  {id:'VITD', name:'Vitamin D/B12', price:1200, rebate:900, lab:650, normal:'Vitamin D: 30-100', unit:'ng/ml', defaultFinding:''},
  {id:'FBC', name:'Full Body Checkup', price:1999, rebate:1499, lab:1000, normal:'Package', unit:'', defaultFinding:''}
];

// Detailed finding templates for Open-Attach-table popup. Add/modify values here for any test.
const ktDetailedPanels = {
  CBC: [
    ['Haemoglobin','M=12-16,F=11-15 gm%',''], ['W.B.C Count','4000-11000 cmm',''], ['DIFFERENTIAL COUNT OF W.B.C','',''],
    ['Neutrophils','40-75 %',''], ['Lymphocytes','20-50 %',''], ['Monocytes','02-08 %',''], ['Eosinophils','01-06 %',''], ['Basophils','00-01 %',''],
    ['R.B.C','3.5-5.5 mill./cumm',''], ['P.C.V/HCT','34-47 %',''], ['M.C.V','80-96/cu µm',''], ['M.C.H','27.5-33.2 Pg',''], ['M.C.H.C','33.4-35.5%',''],
    ['R.D.W.(CV)','11.0-16.0 %',''], ['R.D.W.(SD)','35.0-56.0 fL',''], ['MPV','6.5-12.0 fL',''], ['Platelets Counts','1,00,000-4,00,000/µl',''], ['PCT','0.108-0.282 %',''], ['P-LCR','11.0-45.0 %',''], ['P-LCC','30-90 10^9/l',''], ['PDW','9.0-17.0 fL','']
  ],
  CBCS: [
    ['Peripheral Smear RBC Morphology','',''], ['WBC Series','',''], ['Platelet on smear','',''], ['Parasite','',''], ['Impression','','']
  ],
  BSR: [['Blood Sugar (Random)','74-140 mg/dl','']],
  LFT: [
    ['Total Bilirubin','0.2-1.2 mg/dl',''], ['Direct Bilirubin','0.0-0.3 mg/dl',''], ['Indirect Bilirubin','0.1-1.0 mg/dl',''], ['SGOT / AST','0-40 U/L',''], ['SGPT / ALT','0-45 U/L',''], ['Alkaline Phosphatase','44-147 U/L',''], ['Total Protein','6.0-8.3 g/dl',''], ['Albumin','3.5-5.5 g/dl',''], ['Globulin','2.0-3.5 g/dl',''], ['A/G Ratio','1.0-2.2','']
  ],
  KFT: [
    ['Urea','15-45 mg/dl',''], ['Creatinine','0.6-1.4 mg/dl',''], ['Uric Acid','3.5-7.2 mg/dl',''], ['Sodium','135-145 mmol/L',''], ['Potassium','3.5-5.1 mmol/L',''], ['Chloride','98-107 mmol/L',''], ['Calcium','8.5-10.5 mg/dl','']
  ],
  THY: [['T3','80-200 ng/dl',''], ['T4','5.1-14.1 µg/dl',''], ['TSH','0.4-4.0 mIU/L','']],
  LIPID: [['Total Cholesterol','<200 mg/dl',''], ['Triglycerides','<150 mg/dl',''], ['HDL Cholesterol','>40 mg/dl',''], ['LDL Cholesterol','<100 mg/dl',''], ['VLDL','5-40 mg/dl',''], ['Cholesterol/HDL Ratio','<5.0','']],
  VITD: [['Vitamin D','30-100 ng/ml',''], ['Vitamin B12','200-900 pg/ml','']],
  IGE: [['SERUM IgE','00-200 U/L','']],
  FBC: [['CBC','',''], ['Blood Sugar (Random)','74-140 mg/dl',''], ['LIVER FUNCTION TEST','',''], ['KFT','',''], ['Lipid Profile','Cholesterol <200 mg/dl',''], ['Thyroid Profile','TSH 0.4-4.0 mIU/L','']]
};
function ktPanelKey(name){
  const n=String(name||'').toUpperCase();
  if(n.includes('CBC+')) return 'CBCS'; if(n==='CBC' || n.includes('COMPLETE BLOOD')) return 'CBC';
  if(n.includes('SUGAR')) return 'BSR'; if(n.includes('LIVER') || n==='LFT') return 'LFT'; if(n.includes('KFT') || n.includes('KIDNEY')) return 'KFT';
  if(n.includes('THYROID')) return 'THY'; if(n.includes('LIPID')) return 'LIPID'; if(n.includes('VITAMIN')) return 'VITD'; if(n.includes('IGE')) return 'IGE'; if(n.includes('FULL BODY')) return 'FBC';
  return n.replace(/[^A-Z0-9]/g,'').slice(0,10);
}
function getDetailedTemplate(name){ return ktDetailedPanels[ktPanelKey(name)] || [[name||'Test','', '']]; }
function normalUnitSplit(v){
  v=String(v||'');
  const m=v.match(/^(.*?)(\s+(gm%|cmm|%|mg\/dl|U\/L|g\/dl|mmol\/L|ng\/ml|pg\/ml|mIU\/L|ng\/dl|µg\/dl|fL|Pg|\/µl|10\^9\/l))$/i);
  return {normal:m?m[1].trim():v, unit:m?m[2].trim():''};
}
function ensureFindingModal(){
  if(document.getElementById('findingModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="findingModal" class="finding-modal hidden"><div class="finding-box"><div class="finding-head"><b id="findingModalTitle">TEST VALUES</b><button type="button" onclick="closeFindingModal()">×</button></div><div class="finding-table-wrap"><table><thead><tr><th>Parameter</th><th>Normal Value</th><th>Finding</th></tr></thead><tbody id="findingModalRows"></tbody></table></div><div class="finding-footer"><label>Barcode <input id="findingBarcode" value="2615300084"></label><button type="button" class="legacy-blue" onclick="autoFillPanelData()">Get Data</button><button type="button" class="save-strip small-save" onclick="saveFindingPanel()">Save & Close</button><button type="button" class="btn btn-outline" onclick="closeFindingModal()">Close</button></div></div></div>`);
}
let activeFindingRowIndex = null;
function openFindingPanel(i){
  ensureFindingModal(); activeFindingRowIndex = Number(i);
  const row = collectFindingRows()[activeFindingRowIndex] || {};
  const title = row.name || 'Test';
  document.getElementById('findingModalTitle').textContent = title + ' (' + ktPanelKey(title) + ')';
  let details = row.details;
  if(!details || !details.length){
    details = getDetailedTemplate(title).map(r=>({parameter:r[0], normal:normalUnitSplit(r[1]).normal, unit:normalUnitSplit(r[1]).unit, finding:r[2]||''}));
  }
  document.getElementById('findingModalRows').innerHTML = details.map((r,idx)=>`<tr><td><input data-p="parameter" data-idx="${idx}" value="${escapeHtml(r.parameter||'')}"></td><td><input data-p="normal" data-idx="${idx}" value="${escapeHtml((r.normal||'') + (r.unit?' '+r.unit:''))}"></td><td><input data-p="finding" data-idx="${idx}" value="${escapeHtml(r.finding||'')}"></td></tr>`).join('');
  document.getElementById('findingModal').classList.remove('hidden');
}
function closeFindingModal(){ const m=document.getElementById('findingModal'); if(m) m.classList.add('hidden'); }
function autoFillPanelData(){
  // Demo machine import: fills blank fields with sample placeholders; real analyser integration can replace this.
  document.querySelectorAll('#findingModalRows input[data-p="finding"]').forEach((inp,idx)=>{ if(!inp.value.trim()) inp.value = idx===0 ? '' : ''; });
  alert('Demo: analyser data table opened. Enter values and click Save & Close.');
}
function saveFindingPanel(){
  if(activeFindingRowIndex===null) return;
  const rows = collectFindingRows();
  const detailRows=[];
  document.querySelectorAll('#findingModalRows tr').forEach(tr=>{
    const v={}; tr.querySelectorAll('input[data-p]').forEach(inp=>v[inp.dataset.p]=inp.value);
    const split=normalUnitSplit(v.normal); detailRows.push({parameter:v.parameter, normal:split.normal, unit:split.unit, finding:v.finding});
  });
  rows[activeFindingRowIndex].details = detailRows;
  const firstVal = detailRows.find(x=>String(x.finding||'').trim());
  if(firstVal){ rows[activeFindingRowIndex].finding = firstVal.finding; rows[activeFindingRowIndex].normal = firstVal.normal; rows[activeFindingRowIndex].unit = firstVal.unit; }
  paintFindingRows(rows);
  closeFindingModal();
}
function paintFindingRows(rows){
  const tbody=document.getElementById('findingRows'); if(!tbody) return;
  tbody.innerHTML = rows.map((t,i)=>`<tr>
    <td><input value="${escapeHtml(t.name||'')}" data-r="name" data-i="${i}"><input type="hidden" data-r="testName" data-i="${i}" value="${escapeHtml(t.testName||'')}"><input type="hidden" data-r="category" data-i="${i}" value="${escapeHtml(t.category||'')}"><input type="hidden" data-r="method" data-i="${i}" value="${escapeHtml(t.method||'')}"><input type="hidden" data-r="sample" data-i="${i}" value="${escapeHtml(t.sample||'')}"><input type="hidden" data-r="details" data-i="${i}" value='${escapeHtml(JSON.stringify(t.details||[]))}'></td>
    <td><input value="${escapeHtml(t.normal||'')}" data-r="normal" data-i="${i}"></td>
    <td><input value="${escapeHtml(t.finding||'')}" data-r="finding" data-i="${i}" placeholder="Enter result value"></td>
    <td><input value="${escapeHtml(t.unit||'')}" data-r="unit" data-i="${i}"></td>
    <td><button type="button" class="attach-btn" onclick="openFindingPanel(${i})">Open-Attach-table</button><input value="${escapeHtml(t.comment||'')}" data-r="comment" data-i="${i}" placeholder="Comment"></td>
    <td><select data-r="status" data-i="${i}"><option ${t.status==='Provisional'?'selected':''}>Provisional</option><option ${t.status==='Final'?'selected':''}>Final</option><option ${t.status==='Pending'?'selected':''}>Pending</option></select></td>
    <td><button class="history-btn" onclick="alert('History demo for ${escapeJs(t.name||'Test')}')">HISTORY</button></td>
  </tr>`).join('');
}

let ktEntryTests = [];
let ktCurrentReportBookingId = null;

function ktNowLocal(){
  const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,16);
}
function ktTestRate(test, rateType){
  if(!test) return 0;
  if(rateType==='REBAT') return Number(test.rebate || test.price || 0);
  if(rateType==='LAB.CHARGE') return Number(test.lab || test.price || 0);
  return Number(test.price || 0);
}
function findCatalogTest(name){
  const q=String(name||'').trim().toLowerCase();
  return ktReportCatalog.find(t=>t.name.toLowerCase()===q || t.id.toLowerCase()===q) || ktReportCatalog.find(t=>t.name.toLowerCase().includes(q));
}
function preparePatientEntry(){
  const f=document.getElementById('patientEntryForm');
  if(!f) return;
  document.getElementById('entryBillNo').value = String(980 + get(K.bookings,[]).length + 1);
  document.getElementById('entryAdmDate').value = ktNowLocal();
  document.getElementById('entryCollDate').value = ktNowLocal();
  const dl=document.getElementById('testCatalogList');
  if(dl) dl.innerHTML = ktReportCatalog.map(t=>`<option value="${t.name}">`).join('');
  const staffSel=document.getElementById('entryStaffSelect');
  if(staffSel) staffSel.innerHTML = '<option value="">Select Field Boy</option>'+get(K.staff,[]).map(s=>`<option>${s.name}</option>`).join('');
  ktEntryTests=[]; renderEntryTests(); refreshEntryTotals();
}
function previewEntryTest(){
  const t=findCatalogTest(document.getElementById('entryTestSearch')?.value);
  const rateType=document.querySelector('input[name="rateType"]:checked')?.value || 'GENERAL';
  const r=document.getElementById('entryTestRate');
  if(r) r.value = t ? ktTestRate(t, rateType).toFixed(2) : '';
}
function addEntryTest(){
  const t=findCatalogTest(document.getElementById('entryTestSearch')?.value);
  if(!t){ alert('Please search and select a valid test name.'); return; }
  const rateType=document.querySelector('input[name="rateType"]:checked')?.value || 'GENERAL';
  ktEntryTests.push({id:t.id,name:t.name,normal:t.normal||'',unit:t.unit||'',finding:t.defaultFinding||'',price:ktTestRate(t,rateType),status:'Provisional',comment:''});
  document.getElementById('entryTestSearch').value=''; previewEntryTest(); renderEntryTests(); refreshEntryTotals();
}
function addEntryPackage(){
  const pack=[findCatalogTest('CBC'),findCatalogTest('Blood Sugar'),findCatalogTest('LIVER FUNCTION TEST'),findCatalogTest('SERUM IgE'),findCatalogTest('KFT')].filter(Boolean);
  const rateType=document.querySelector('input[name="rateType"]:checked')?.value || 'GENERAL';
  pack.forEach(t=>ktEntryTests.push({id:t.id,name:t.name,normal:t.normal||'',unit:t.unit||'',finding:t.defaultFinding||'',price:ktTestRate(t,rateType),status:'Provisional',comment:'',package:'Full Body Checkup'}));
  renderEntryTests(); refreshEntryTotals();
}
function renderEntryTests(){
  const body=document.getElementById('entryTestsBody');
  if(!body) return;
  body.innerHTML = ktEntryTests.length ? ktEntryTests.map((t,i)=>`<tr><td>${t.name}</td><td>${t.package||''}</td><td>${Number(t.price).toFixed(2)}</td><td><button type="button" class="mini-remove" onclick="ktEntryTests.splice(${i},1);renderEntryTests();refreshEntryTotals()">Remove</button></td></tr>`).join('') : '<tr><td colspan="4">No test added.</td></tr>';
  const c=document.getElementById('entryTestCount'); if(c) c.textContent=ktEntryTests.length;
}
function refreshEntryTotals(){
  const rateType=document.querySelector('input[name="rateType"]:checked')?.value || 'GENERAL';
  ktEntryTests = ktEntryTests.map(row=>{ const base=findCatalogTest(row.name); return {...row, price: ktTestRate(base,row.price && rateType ? rateType : 'GENERAL')}; });
  renderEntryTests();
  const gross=ktEntryTests.reduce((s,t)=>s+Number(t.price||0),0);
  const cash=Number(document.getElementById('cashReceived')?.value||0);
  const card=Number(document.getElementById('cardReceived')?.value||0);
  const disc=Number(document.getElementById('discount')?.value||0);
  const bal=gross-cash-card-disc;
  if(document.getElementById('grossTotal')) document.getElementById('grossTotal').value=gross.toFixed(2);
  if(document.getElementById('balanceDue')) document.getElementById('balanceDue').value=bal.toFixed(2);
}
function savePatientEntry(e){
  e.preventDefault();
  if(!ktEntryTests.length){ alert('Please add at least one test.'); return; }
  const f=e.target;
  const gross=ktEntryTests.reduce((s,t)=>s+Number(t.price||0),0);
  const cash=Number(f.cashReceived.value||0), card=Number(f.cardReceived.value||0), discount=Number(f.discount.value||0);
  const booking={
    id:'KTB'+f.billNo.value, remoteNo:f.remoteNo.value, billNo:f.billNo.value, dayNo:f.dayNo.value,
    patientName:normPatientName(f.patientName.value), age:f.age.value, gender:f.gender.value, phone:f.phone.value.trim(), email:f.email.value.trim(),
    doctor:f.doctor.value, coName:f.coName.value, pathologyName:f.pathologyName.value, associateLab:f.associateLab.value,
    test:ktEntryTests.map(t=>t.name).join(', '), tests:ktEntryTests, price:gross, bookingType:'Centre Visit',
    date:(f.admDate.value||'').slice(0,10), time:(f.admDate.value||'').slice(11), admDate:f.admDate.value, collDate:f.collDate.value,
    address:'Lab Centre', status:'Provisional', payment: cash+card>=gross-discount?'Paid':'Due', staff:f.fieldBoy.value||'Not Assigned',
    cashReceived:cash, cardReceived:card, discount, balanceDue:gross-cash-card-discount, remarks:f.remarks.value,
    rateType:f.rateType.value, createdAt:new Date().toISOString(), reportReleased:false, reportBillNo:'', reportValues:null
  };
  let bs=get(K.bookings,[]); bs.unshift(booking); set(K.bookings,bs);
  let pays=get(K.payments,[]); pays.unshift({id:uid('PAY'),bookingId:booking.id,email:booking.email,amount:gross,mode:'Cash:'+cash+' Card:'+card,status:booking.payment,date:new Date().toISOString()}); set(K.payments,pays);
  addNotification('Patient entry saved: Bill '+booking.billNo+' / '+booking.patientName);
  alert('Patient entry saved. Now open Report Generate and release report.');
  f.reset(); preparePatientEntry(); renderMetrics(); renderBookings(); renderReportBookingSelect();
}
function renderReportBookingSelect(){
  const sel=document.getElementById('reportBookingSelect'); if(!sel) return;
  const bs=get(K.bookings,[]);
  sel.innerHTML='<option value="">Select patient / bill</option>'+bs.map(b=>`<option value="${b.id}">${b.billNo||b.id} - ${b.patientName} - ${b.test}</option>`).join('');
}
function loadReportEditor(id){
  ktCurrentReportBookingId=id;
  const box=document.getElementById('reportEditor'); if(!box) return;
  if(!id){box.classList.add('hidden');return;}
  const b=get(K.bookings,[]).find(x=>x.id===id); if(!b) return;
  box.classList.remove('hidden');
  const map={rRemoteNo:b.remoteNo||'0', rBillNo:b.billNo||b.id, rAdmDate:b.admDate||b.date||'', rCollDate:b.collDate||b.date||'', rDayNo:b.dayNo||'0', rPathology:b.pathologyName||'BN-MAIN', rPatientName:b.patientName||'', rAge:b.age||'', rPhone:b.phone||'', rGender:b.gender||'', rEmail:b.email||'', rDoctor:b.doctor||'', rCoName:b.coName||'', rFieldBoy:b.staff||''};
  Object.entries(map).forEach(([id,val])=>{const el=document.getElementById(id); if(el) el.value=val;});
  document.getElementById('rReportingDate').value=ktNowLocal();
  const rows=(b.reportValues && b.reportValues.length ? b.reportValues : (b.tests&&b.tests.length?b.tests:[{name:b.test,normal:'',finding:'',unit:'',status:b.status||'Provisional',comment:''}]));
  paintFindingRows(rows);
}
function collectFindingRows(){
  const rows=[];
  document.querySelectorAll('#findingRows tr').forEach((tr,i)=>{
    const obj={};
    tr.querySelectorAll('[data-r]').forEach(el=>{
      if(el.dataset.r==='details'){
        try{ obj.details = JSON.parse(el.value || '[]'); }catch(e){ obj.details=[]; }
      }else obj[el.dataset.r]=el.value;
    });
    rows.push(obj);
  });
  return rows;
}
function updateReportValuesOnly(){
  const bs=get(K.bookings,[]); const b=bs.find(x=>x.id===ktCurrentReportBookingId); if(!b) return null;
  b.reportValues=collectFindingRows(); b.reportingDate=document.getElementById('rReportingDate').value; set(K.bookings,bs); return b;
}
function openReportPreview(){
  const b=updateReportValuesOnly(); if(!b){ alert('Please select booking.'); return; }
  window.open('report.html?bill='+encodeURIComponent(b.billNo||b.id), '_blank');
}
function releaseGeneratedReport(){
  const b=updateReportValuesOnly(); if(!b){ alert('Please select booking.'); return; }
  let bs=get(K.bookings,[]); let row=bs.find(x=>x.id===b.id);
  row.reportReleased=true;
  row.reportBillNo=row.billNo||row.id;
  row.status='Reported';
  set(K.bookings,bs);
  addNotification('Report released for Bill '+(row.billNo||row.id)+' / '+row.patientName);
  renderMetrics(); renderBookings(); renderReportBookingSelect(); alert('Report released. Use View Report to open the A4 report page.');
}
function escapeHtml(v){return String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
function escapeJs(v){return String(v??'').replace(/[\\'\"]/g,'');}

// override adminDashboard to initialize new controls safely
const oldAdminDashboard = adminDashboard;
adminDashboard = function(){
  requireSession('admin'); renderMetrics(); renderBookings(); renderTests(); renderStaff(); renderPackages(); renderNotifications(); preparePatientEntry(); renderReportBookingSelect();
};
