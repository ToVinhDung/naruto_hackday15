/** Banking dashboard: presentation and navigation over the existing escrow state. */
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v11H6a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v5h5M16 14.5h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  alert: '<path d="m12 3 10 18H2zM12 9v5M12 17h.01"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M12 16h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  bank: '<path d="m3 8 9-5 9 5H3zm1 12h16M6 11v6m6-6v6m6-6v6"/>',
  link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1)"/>'
};
export const bankIcon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
export const escapeBankText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('vi-VN').format(Math.round(Number(value) || 0)) + ' ₫';
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
const statuses = {
  IN_PROGRESS: ['Đang thực hiện', 'blue'], SUBMITTED: ['Chờ nghiệm thu', 'amber'],
  REVISION_REQUESTED: ['Cần chỉnh sửa', 'amber'], PARTIALLY_RELEASED: ['Giải ngân một phần', 'green'],
  DISPUTED: ['Đang tranh chấp', 'red'], RELEASED: ['Đã giải ngân', 'green'],
  REFUNDED: ['Đã hoàn trả', 'neutral'], SPLIT: ['Đã phân xử', 'neutral']
};
export function filterBankContracts(contracts, query = '', filter = 'ALL') {
  const term = fold(query).trim();
  return contracts.filter(c => {
    const matched = !term || fold(`${c.id} ${c.title} ${c.freelancer}`).includes(term);
    const statusMatch = filter === 'ALL' || (filter === 'ACTIVE' ? c.amount > 0 : c.status === filter);
    return matched && statusMatch;
  });
}
export function summarizeBankState(state, role) {
  const contracts = state.contracts || [];
  const locked = contracts.reduce((s,c) => s + Number(c.amount || 0), 0);
  const disputed = contracts.filter(c => c.status === 'DISPUTED');
  const frozen = disputed.reduce((s,c) => s + Number(c.amount || 0), 0);
  const pending = role === 'freelancer' ? [] : (state.pendingTopups || []).filter(t => t.status === 'PENDING_APPROVAL');
  return {locked, frozen, pending, disputed, active:contracts.filter(c => c.amount > 0),
    wallet: role === 'client' ? state.clientBalance : role === 'freelancer' ? state.freelancerBalance : null,
    review: contracts.filter(c => c.status === (role === 'freelancer' ? 'REVISION_REQUESTED' : 'SUBMITTED'))};
}

export function createBankDashboard({openZone, openContract, getState, getRole}) {
  const byId = id => document.getElementById(id);
  let page = 'overview', currentZone = null, query = '', filter = 'ALL', pageIndex = 0, previousRole;
  const pageSize = 6;
  const roleNames = {client:'Khách hàng', freelancer:'Freelancer', arbiter:'Trọng tài'};
  const zoneLabels = {
    'view-client-zone-1':'Hợp đồng ký quỹ', 'view-client-zone-2':'Nạp tiền', 'view-client-zone-3':'Tạo hợp đồng',
    'view-freelancer-zone-1':'Bàn giao sản phẩm', 'view-freelancer-zone-2':'Hợp đồng đảm nhận', 'view-freelancer-zone-3':'Rút tiền',
    'view-arbiter-zone-1':'Xử lý tranh chấp', 'view-arbiter-zone-2':'Chứng cứ & giám sát', 'view-arbiter-zone-3':'Sổ cái & tín nhiệm'
  };
  const zoneFor = type => {
    const role = getRole();
    if(type === 'primary') return role === 'client' ? 'view-client-zone-3' : role === 'freelancer' ? 'view-freelancer-zone-1' : null;
    if(type === 'money') return role === 'client' ? 'view-client-zone-2' : role === 'freelancer' ? 'view-freelancer-zone-3' : null;
  };
  function closeMenu() {
    document.body.classList.remove('bank-menu-open');
    byId('bank-menu-toggle').setAttribute('aria-expanded','false');
  }
  function navigate(destination) {
    closeMenu();
    if(destination.startsWith('view-')) {openZone(destination); return;}
    openZone(null);
    page = destination;
    query = ''; pageIndex = 0; filter = destination === 'disputes' ? 'DISPUTED' : 'ALL';
    byId('bank-search').value = '';
    render();
    window.scrollTo({top:0, behavior:'instant'});
  }
  function setPage(zoneId) {
    page = zoneId ? 'zone' : 'overview';
    currentZone = zoneId;
    closeMenu();
    render();
    window.scrollTo({top:0, behavior:'instant'});
    byId('bank-page-title').focus({preventScroll:true});
  }
  function navigation() {
    const role = getRole();
    const base = [ ['overview','Tổng quan','grid'], ['contracts','Hợp đồng','file'] ];
    if(role === 'client') base.push(['view-client-zone-2','Nạp tiền','wallet'],['view-client-zone-3','Tạo hợp đồng','plus']);
    if(role === 'freelancer') base.push(['view-freelancer-zone-1','Bàn giao sản phẩm','upload'],['view-freelancer-zone-3','Rút tiền','wallet']);
    if(role === 'arbiter') base.push(['topups','Phê duyệt nạp tiền','check'],['view-arbiter-zone-2','Chứng cứ & giám sát','shield']);
    base.push([role === 'arbiter' ? 'view-arbiter-zone-1' : 'disputes','Tranh chấp','alert'],['history','Lịch sử giao dịch','clock']);
    if(role === 'arbiter') base.push(['view-arbiter-zone-3','Sổ cái & tín nhiệm','file']);
    return base;
  }
  function renderNavigation(summary) {
    byId('bank-navigation').innerHTML = navigation().map(([key,label,icon]) => {
      const contractZone = {client:'view-client-zone-1',freelancer:'view-freelancer-zone-2'}[getRole()];
      const selected = page === key || page === 'zone' && (currentZone === key || key === 'contracts' && currentZone === contractZone);
      const count = key === 'topups' ? summary.pending.length : ['disputes','view-arbiter-zone-1'].includes(key) ? summary.disputed.length : 0;
      return `<button type="button" class="bank-nav-item ${selected ? 'is-active' : ''}" data-bank-nav="${key}" ${selected ? 'aria-current="page"' : ''}>${bankIcon(icon)}<span>${label}</span>${count ? `<span class="bank-nav-count">${count}</span>` : ''}</button>`;
    }).join('');
  }
  function renderTable() {
    const contracts = getState().contracts || [];
    const matched = filterBankContracts(contracts,query,filter);
    pageIndex = Math.min(pageIndex, Math.max(0,Math.ceil(matched.length/pageSize)-1));
    const visible = matched.slice(pageIndex*pageSize,(pageIndex+1)*pageSize);
    const filters = [['ALL','Tất cả'],['SUBMITTED','Chờ nghiệm thu'],['DISPUTED','Tranh chấp']];
    byId('bank-filters').innerHTML = filters.map(([key,label]) => `<button type="button" data-bank-filter="${key}" class="bank-filter ${filter===key?'is-active':''}" aria-pressed="${filter===key}">${label}<span>${filterBankContracts(contracts,'',key).length}</span></button>`).join('');
    byId('bank-contract-rows').innerHTML = visible.length ? visible.map(c => {
      const [label,tone] = statuses[c.status] || [c.status,'neutral'];
      const name = String(c.freelancer || 'Chưa cập nhật').split(' (')[0];
      const job = String(c.freelancer || '').match(/\((.+)\)/)?.[1] || 'Đối tác thực hiện';
      return `<tr><td><button type="button" class="bank-contract-link" data-bank-contract="${escapeBankText(c.id)}">${escapeBankText(c.id)}</button><span class="bank-contract-name">${escapeBankText(c.title)}</span></td><td><span class="bank-partner">${escapeBankText(name)}</span><span class="bank-cell-sub">${escapeBankText(job)}</span></td><td class="bank-amount">${money(c.amount)}<span class="bank-cell-sub">Đang ký quỹ</span></td><td><span class="bank-status bank-status-${tone}"><i></i>${escapeBankText(label)}</span></td><td><button type="button" class="bank-row-open" data-bank-contract="${escapeBankText(c.id)}" aria-label="Xem hợp đồng ${escapeBankText(c.id)}">${bankIcon('chevron')}</button></td></tr>`;
    }).join('') : `<tr><td colspan="5"><div class="bank-empty">${bankIcon('search')}<strong>Không tìm thấy hợp đồng</strong><span>Thử tên, mã hợp đồng hoặc bộ lọc khác.</span><button type="button" class="bank-text-button" data-bank-action="clear-search">Xóa bộ lọc</button></div></td></tr>`;
    const start = matched.length ? pageIndex*pageSize+1 : 0;
    byId('bank-table-count').textContent = `${start}–${Math.min((pageIndex+1)*pageSize,matched.length)} trong ${matched.length} hợp đồng`;
    byId('bank-prev').disabled = pageIndex === 0;
    byId('bank-next').disabled = (pageIndex+1)*pageSize >= matched.length;
  }
  function renderTasks(summary) {
    const tasks = [];
    if(summary.review.length) tasks.push({title:`${summary.review.length} hợp đồng ${getRole()==='freelancer'?'cần chỉnh sửa':'chờ nghiệm thu'}`,sub:getRole()==='freelancer'?'Xem phản hồi và cập nhật bàn giao':'Kiểm tra bàn giao trước khi giải ngân',icon:'file',tone:'green',action:'review'});
    if(summary.pending.length) tasks.push({title:`${summary.pending.length} yêu cầu nạp tiền`,sub:getRole()==='arbiter'?'Đang chờ bạn đối soát và phê duyệt':'Đang chờ Trọng tài xác nhận',icon:'wallet',tone:'gold',action:'topups'});
    if(summary.disputed.length) tasks.push({title:`${summary.disputed.length} hợp đồng tranh chấp`,sub:`${money(summary.frozen)} đang tạm giữ`,icon:'alert',tone:'red',action:'disputes'});
    byId('bank-tasks').innerHTML = tasks.map(t=>`<button type="button" class="bank-task" data-bank-action="${t.action}"><span class="bank-task-icon ${t.tone}">${bankIcon(t.icon)}</span><span><strong>${t.title}</strong><small>${t.sub}</small></span>${bankIcon('chevron')}</button>`).join('') || '<div class="bank-caught-up">Bạn đã xử lý hết công việc cần chú ý.</div>';
    byId('bank-task-count').textContent = tasks.reduce((s,t)=>s+Number(t.title.split(' ')[0]),0);
    const notices = summary.pending.length+summary.disputed.length+summary.review.length;
    byId('bank-notification-dot').hidden = notices===0;
    byId('bank-notification-button').setAttribute('aria-label',`${notices} mục cần chú ý`);
    byId('bank-all-escrow').textContent = money(summary.locked);
    byId('bank-working-escrow').textContent = money(summary.locked-summary.frozen);
    byId('bank-frozen-escrow').textContent = money(summary.frozen);
    byId('bank-fund-track').innerHTML = summary.locked ? `<span style="width:${100*(summary.locked-summary.frozen)/summary.locked}%"></span><span style="width:${100*summary.frozen/summary.locked}%"></span>` : '';
  }
  function renderActivities() {
    const events = getState().ledger || [];
    const markup = tx => {
      const targetAttr = tx.contractId ? ` data-bank-contract="${escapeBankText(tx.contractId)}" style="cursor:pointer;" title="Mở chi tiết hợp đồng ${escapeBankText(tx.contractId)}"` : '';
      return `<div class="bank-activity"${targetAttr}><span class="bank-activity-icon">${bankIcon(tx.role==='ARBITER'?'shield':tx.role==='CLIENT'?'wallet':'upload')}</span><div><strong>${escapeBankText(tx.type)}</strong><p>${escapeBankText(tx.detail)}</p><small>${escapeBankText(tx.time)} · ${escapeBankText(tx.id)}</small></div><span class="bank-activity-amount">${money(tx.amount)}</span></div>`;
    };
    byId('bank-recent-activity').innerHTML = events.slice(0,3).map(markup).join('') || '<p class="bank-caught-up">Chưa có hoạt động nào.</p>';
    byId('bank-history-list').innerHTML = events.map(markup).join('') || '<p class="bank-caught-up">Chưa có giao dịch nào.</p>';
    byId('bank-history-count').textContent = `${events.length} sự kiện`;
  }
  function render() {
    const role = getRole(), state = getState(), summary = summarizeBankState(state,role);
    if(previousRole !== role) {query=''; filter='ALL'; pageIndex=0; byId('bank-search').value=''; previousRole=role;}
    document.body.dataset.bankPage = page;
    document.body.dataset.bankRole = role;
    const tableVisible = ['overview','contracts','disputes'].includes(page);
    byId('bank-dashboard').hidden = !tableVisible;
    byId('bank-history-page').hidden = page !== 'history';
    byId('bank-topups-page').hidden = page !== 'topups';
    document.querySelector('.finance-strip').hidden = page !== 'overview';
    byId('bank-right-column').hidden = page !== 'overview';
    byId('bank-recent-section').hidden = page !== 'overview';
    byId('bank-quick-actions').hidden = page !== 'overview';
    const titles = {overview:'Tổng quan tài khoản', contracts:'Hợp đồng ký quỹ', disputes:'Hợp đồng tranh chấp', history:'Lịch sử giao dịch', topups:'Theo dõi nạp tiền', zone:zoneLabels[currentZone] || 'Giao dịch'};
    const subtitles = {overview:'Theo dõi dòng tiền và quản lý hợp đồng trong một không gian.', contracts:'Theo dõi tiến độ, nghiệm thu và giải ngân từng hợp đồng.', disputes:'Xem hồ sơ và các khoản tiền đang tạm giữ.', history:'Các sự kiện được ghi nhận trong phiên làm việc.', topups:'Theo dõi các yêu cầu đang chờ đối soát và xác nhận.', zone:'Hoàn tất thông tin và kiểm tra trước khi xác nhận.'};
    byId('bank-page-title').textContent = titles[page];
    byId('bank-page-subtitle').textContent = subtitles[page];
    byId('bank-breadcrumb').textContent = page==='overview'?'Tổng quan':titles[page];
    byId('bank-profile-role').textContent = roleNames[role];
    byId('bank-profile-initials').textContent = {client:'KH',freelancer:'FL',arbiter:'TT'}[role];
    byId('bank-table-title').textContent = page==='overview'?'Hợp đồng gần đây':titles[page];
    byId('bank-see-contracts').hidden = page !== 'overview';
    byId('bank-primary-label').textContent = role==='client'?'Tạo hợp đồng':role==='freelancer'?'Gửi bàn giao':'Duyệt nạp tiền';
    byId('bank-quick-actions').innerHTML = [
      {label:role==='client'?'Nạp tiền':role==='freelancer'?'Rút tiền':'Duyệt nạp tiền',sub:role==='arbiter'?'Đối soát yêu cầu':'Quản lý số dư',icon:'wallet',action:'money'},
      {label:role==='client'?'Tạo hợp đồng':role==='freelancer'?'Gửi bàn giao':'Xem chứng cứ',sub:role==='client'?'Bắt đầu giao dịch mới':'Mở không gian làm việc',icon:role==='client'?'plus':'file',action:role==='arbiter'?'evidence':'primary'},
      {label:'Lịch sử giao dịch',sub:'Tra cứu các hoạt động',icon:'clock',action:'history'}
    ].map(x=>`<button type="button" class="bank-quick-action" data-bank-action="${x.action}"><span class="bank-quick-icon">${bankIcon(x.icon)}</span><span><strong>${x.label}</strong><small>${x.sub}</small></span>${bankIcon('arrow')}</button>`).join('');
    renderNavigation(summary); renderTable(); renderTasks(summary); renderActivities();
    document.querySelectorAll('[data-login-role]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.loginRole===role)));
    document.querySelectorAll('.zone-content-view .contract-card[data-open-tx-popup]').forEach(card=>{card.tabIndex=0;card.setAttribute('role','button');});
  }
  document.querySelectorAll('[data-bank-icon]').forEach(el=>{el.innerHTML=bankIcon(el.dataset.bankIcon);});
  byId('bank-current-date').textContent = new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
  byId('bank-search').addEventListener('input', e=>{query=e.target.value;pageIndex=0;renderTable();});
  byId('bank-prev').addEventListener('click',()=>{pageIndex--;renderTable();});
  byId('bank-next').addEventListener('click',()=>{pageIndex++;renderTable();});
  byId('bank-menu-toggle').addEventListener('click',()=>{
    const open=document.body.classList.toggle('bank-menu-open');
    byId('bank-menu-toggle').setAttribute('aria-expanded',String(open));
    if(open) byId('bank-sidebar').querySelector('button')?.focus();
  });
  byId('bank-menu-scrim').addEventListener('click',closeMenu);
  window.matchMedia('(min-width: 801px)').addEventListener('change',event=>{if(event.matches) closeMenu();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape') closeMenu();
    if(['Enter',' '].includes(e.key) && e.target.matches('.contract-card[role="button"]')) {e.preventDefault();e.target.click();}
    if(e.key==='Tab' && document.body.classList.contains('bank-menu-open')) {
      const items=[...byId('bank-sidebar').querySelectorAll('button,summary')].filter(el=>el.getClientRects().length);
      if(e.shiftKey && document.activeElement===items[0]) {e.preventDefault();items.at(-1)?.focus();}
      else if(!e.shiftKey && document.activeElement===items.at(-1)) {e.preventDefault();items[0]?.focus();}
    }
  });
  document.addEventListener('click',e=>{
    if(e.target.closest('#btn-toggle-onboarding-guide')) {
      closeMenu();
      if(!byId('non-tech-onboarding-strip').hidden) byId('non-tech-onboarding-strip').scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }
    if(e.target.closest('.bank-tools button')) closeMenu();
    const contract=e.target.closest('[data-bank-contract]');
    if(contract) {openContract(contract.dataset.bankContract);return;}
    const nav=e.target.closest('[data-bank-nav]');
    if(nav) {navigate(nav.dataset.bankNav);return;}
    const tab=e.target.closest('[data-bank-filter]');
    if(tab) {filter=tab.dataset.bankFilter;pageIndex=0;renderTable();return;}
    const action=e.target.closest('[data-bank-action]')?.dataset.bankAction;
    if(!action) return;
    if(action==='primary' || action==='money') navigate(zoneFor(action) || 'topups');
    else if(action==='evidence') navigate('view-arbiter-zone-2');
    else if(action==='review') {navigate('contracts');filter=getRole()==='freelancer'?'REVISION_REQUESTED':'SUBMITTED';renderTable();}
    else if(action==='disputes') navigate(getRole()==='arbiter'?'view-arbiter-zone-1':'disputes');
    else if(action==='notifications') {navigate('overview');byId('bank-attention-panel').scrollIntoView({behavior:'smooth',block:'center'});byId('bank-attention-panel').focus({preventScroll:true});}
    else if(action==='clear-search') {query='';filter='ALL';byId('bank-search').value='';pageIndex=0;renderTable();}
    else if(action==='close-menu') closeMenu();
    else navigate(action);
  });
  // Keep dialogs usable by keyboard, including the existing dynamically-rendered dialogs.
  let previousDialog=null, restoreFocus=null;
  const dialogObserver=new MutationObserver(()=>{
    const modal=[...document.querySelectorAll('.modal-backdrop')].find(el=>!el.hidden);
    if(modal===previousDialog) return;
    if(modal) {
      restoreFocus=document.activeElement;
      const card=modal.querySelector('.modal-card');
      card?.setAttribute('role','dialog');card?.setAttribute('aria-modal','true');
      if(card && !card.hasAttribute('aria-labelledby')) card.setAttribute('aria-label','Chi tiết giao dịch');
      modal.querySelector('button,input,textarea,select')?.focus();
    } else {restoreFocus?.focus?.();restoreFocus=null;}
    previousDialog=modal;
    document.body.classList.toggle('bank-dialog-open',Boolean(modal));
  });
  document.querySelectorAll('.modal-backdrop').forEach(el=>dialogObserver.observe(el,{attributes:true,attributeFilter:['hidden']}));
  document.addEventListener('keydown',e=>{
    if(e.key!=='Tab'||!previousDialog) return;
    const elements=[...previousDialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
    if(!elements.length) return;
    if(e.shiftKey && document.activeElement===elements[0]) {e.preventDefault();elements.at(-1).focus();}
    else if(!e.shiftKey && document.activeElement===elements.at(-1)) {e.preventDefault();elements[0].focus();}
  });
  return {render,setPage};
}
