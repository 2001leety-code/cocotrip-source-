// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
const uid = 'synthetic-owner';
async function fresh() { vi.resetModules(); return import('../../src/lib/aiPlanIssuanceNotice'); }
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
describe('AI issuance hint, never payment authority', () => {
  it('settles only its order across attempts, keeping a second order pending', async () => {
    const m = await fresh();
    m.beginAiPlanNotice(uid,'one','a'); m.beginAiPlanNotice(uid,'one','a');
    m.beginAiPlanNotice(uid,'one','b'); m.beginAiPlanNotice(uid,'two','c');
    expect(m.readAiPlanNotices(uid).notices).toHaveLength(3);
    m.linkAiPlanNotice(uid,'one','a','plan-one');
    m.settleAiPlanNoticesFromOwnerRead({currentUid:uid,viewerUid:uid,planId:'plan-one',fromCache:false,hasPendingWrites:false,data:{uid,planId:'plan-one',status:'ready',input:{paypalOrderId:'one'}}});
    expect(m.readAiPlanNotices(uid).notices.map(n=>n.orderId)).toEqual(['two']);
  });
  it('failed completion persistence settles this tab only and reload re-protects', async () => {
    const m = await fresh(); m.beginAiPlanNotice(uid,'one','a'); m.linkAiPlanNotice(uid,'one','a','plan-one');
    const set = vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new Error('synthetic quota');});
    m.settleAiPlanNoticesFromOwnerRead({currentUid:uid,viewerUid:uid,planId:'plan-one',fromCache:false,hasPendingWrites:false,data:{uid,planId:'plan-one',status:'ready',input:{paypalOrderId:'one'}}});
    expect(m.readAiPlanNotices(uid)).toEqual({notices:[],storageUnavailable:true});
    set.mockRestore(); const reloaded=await fresh();
    expect(reloaded.readAiPlanNotices(uid).notices).toHaveLength(1);
  });
  it('links an unknown plan only through an exact fresh owner/order ready read', async () => {
    const m=await fresh();m.beginAiPlanNotice(uid,'unknown-order','a');m.beginAiPlanNotice(uid,'other-order','b');m.beginAiPlanNotice('other-user','unknown-order','c');
    m.settleAiPlanNoticesFromOwnerRead({currentUid:uid,viewerUid:uid,planId:'server-plan',fromCache:false,hasPendingWrites:false,data:{uid,planId:'server-plan',status:'ready',input:{paypalOrderId:'unknown-order'}}});
    expect(m.readAiPlanNotices(uid).notices.map(n=>n.orderId)).toEqual(['other-order']);
    expect(m.readAiPlanNotices('other-user').notices).toHaveLength(1);
    expect(m.hasCompletedAiPlanNotice(uid,'unknown-order')).toBe(true);
  });
  it.each([false,true])('any conflicting known attempt keeps the entire order pending, mixed=%s',async mixed=>{
    const m=await fresh();m.beginAiPlanNotice(uid,'conflict','bad');m.linkAiPlanNotice(uid,'conflict','bad','different-plan');
    if(mixed){m.beginAiPlanNotice(uid,'conflict','unknown');m.beginAiPlanNotice(uid,'conflict','match');m.linkAiPlanNotice(uid,'conflict','match','server-plan');}
    m.settleAiPlanNoticesFromOwnerRead({currentUid:uid,viewerUid:uid,planId:'server-plan',fromCache:false,hasPendingWrites:false,data:{uid,planId:'server-plan',status:'ready',input:{paypalOrderId:'conflict'}}});
    expect(m.readAiPlanNotices(uid).notices).toHaveLength(mixed?3:1);expect(m.hasCompletedAiPlanNotice(uid,'conflict')).toBe(false);
  });
  it.each(['list','read','malformed','invalid-plan'])('does not settle when conflict absence cannot be established: %s',async mode=>{
    const m=await fresh();m.beginAiPlanNotice(uid,'uncertain','a');
    const key='cocotrip:ai-issuance-notice:v1:pending:'+uid+':uncertain:a';
    if(mode==='malformed')localStorage.setItem(key,'{broken');
    if(mode==='invalid-plan'){const n=JSON.parse(localStorage.getItem(key)!);n.planId='https://invalid.test/token';localStorage.setItem(key,JSON.stringify(n));}
    const spy=mode==='list'?vi.spyOn(Storage.prototype,'key').mockImplementation(()=>{throw new Error('synthetic list denied');}):mode==='read'?vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('synthetic read denied');}):null;
    m.settleAiPlanNoticesFromOwnerRead({currentUid:uid,viewerUid:uid,planId:'server-plan',fromCache:false,hasPendingWrites:false,data:{uid,planId:'server-plan',status:'ready',input:{paypalOrderId:'uncertain'}}});
    spy?.mockRestore();expect(m.hasCompletedAiPlanNotice(uid,'uncertain')).toBe(false);expect(m.readAiPlanNotices(uid).notices).toHaveLength(1);
  });
  it('does not hide a same-key memory/disk plan conflict by merging records',async()=>{
    const m=await fresh();m.beginAiPlanNotice(uid,'same-key','a');m.linkAiPlanNotice(uid,'same-key','a','memory-plan');
    const key='cocotrip:ai-issuance-notice:v1:pending:'+uid+':same-key:a';
    const disk=JSON.parse(localStorage.getItem(key)!);disk.planId='disk-plan';localStorage.setItem(key,JSON.stringify(disk));
    m.settleAiPlanNoticesFromOwnerRead({currentUid:uid,viewerUid:uid,planId:'disk-plan',fromCache:false,hasPendingWrites:false,data:{uid,planId:'disk-plan',status:'ready',input:{paypalOrderId:'same-key'}}});
    expect(m.hasCompletedAiPlanNotice(uid,'same-key')).toBe(false);
  });
  it('keeps multiple orders, scopes accounts and rejects invalid IDs and URLs', async () => {
    const m = await fresh();
    m.beginAiPlanNotice(uid, 'one', 'a'); m.beginAiPlanNotice(uid, 'two', 'b');
    m.beginAiPlanNotice('other', 'three', 'c');
    expect(m.readAiPlanNotices(uid).notices).toHaveLength(2);
    expect(m.beginAiPlanNotice(null, 'one', 'a')).toBeNull();
    expect(m.beginAiPlanNotice('\ud800', 'one', 'a')).toBeNull();
    m.linkAiPlanNotice(uid, 'one', 'a', 'https://example.test/?token=secret');
    expect(m.readAiPlanNotices(uid).notices[0].planId).toBeUndefined();
  });
  it('requires exact fresh owner completion and dominates late pending', async () => {
    const m = await fresh(); m.beginAiPlanNotice(uid, 'one', 'a');
    const data = {uid, planId:'plan-one', status:'ready', input:{paypalOrderId:'one'}};
    const input = {currentUid:uid,viewerUid:uid,planId:'plan-one',fromCache:false,hasPendingWrites:false,data};
    m.linkAiPlanNotice(uid, 'one', 'a', 'plan-one');
    for (const wrong of [{fromCache:true},{hasPendingWrites:true},{currentUid:'other'}, {data:{...data,status:undefined}}, {data:{...data,_streaming_in_progress:true}}, {data:{...data,_p231_stub:true}}, {data:{...data,input:{paypalOrderId:'other'}}}]) {
      m.settleAiPlanNoticesFromOwnerRead({...input,...wrong});
      expect(m.readAiPlanNotices(uid).notices).toHaveLength(1);
    }
    m.settleAiPlanNoticesFromOwnerRead(input);
    expect(m.readAiPlanNotices(uid).notices).toHaveLength(0);
    expect(m.beginAiPlanNotice(uid,'one','late')).toBeNull();
    const reloaded = await fresh();
    expect(reloaded.beginAiPlanNotice(uid,'one','late')).toBeNull();
  });
  it('keeps current-tab protection when persistence fails and reports the limitation', async () => {
    const m = await fresh();
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new Error('synthetic quota');});
    expect(m.beginAiPlanNotice(uid,'one','a')?.persisted).toBe(false);
    expect(m.readAiPlanNotices(uid)).toMatchObject({storageUnavailable:true,notices:[{orderId:'one'}]});
  });
  it('retains loaded hints in memory when storage subsequently becomes unavailable', async () => {
    const m = await fresh(); m.beginAiPlanNotice(uid,'one','a');
    const reloaded = await fresh(); expect(reloaded.readAiPlanNotices(uid).notices).toHaveLength(1);
    vi.spyOn(Storage.prototype,'key').mockImplementation(() => {throw new Error('synthetic denied');});
    expect(reloaded.readAiPlanNotices(uid)).toMatchObject({storageUnavailable:true,notices:[{orderId:'one'}]});
  });
  it('reacts to cross-tab storage and pageshow without trusting event payload', async () => {
    const m = await fresh(); const listener = vi.fn(); const stop=m.subscribeAiPlanNotices(listener);
    window.dispatchEvent(new StorageEvent('storage',{key:null}));
    window.dispatchEvent(new Event('pageshow')); expect(listener).toHaveBeenCalledTimes(2);
    expect(m.readAiPlanNotices(uid).notices).toHaveLength(0); stop();
  });
});
