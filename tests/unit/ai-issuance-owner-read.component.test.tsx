// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
const state = vi.hoisted(() => ({
 user:{uid:'owner-read-user'}, language:'en', renderedTitle:null as string|null,
 ui:null as null|((snapshot:unknown)=>void), completion:null as null|((snapshot:unknown)=>void),
 uiError:null as null|((error:unknown)=>void), completionError:null as null|((error:unknown)=>void),
 uiUnsub:vi.fn(), completionUnsub:vi.fn(), throwCompletion:false, refs:[] as unknown[],
}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:state.user,loading:false})}));
vi.mock('@/hooks/useLanguage',async()=>{const {default:en}=await import('@/i18n/locales/en.json');return {useLanguage:()=>({language:state.language,t:en,changeLanguage:vi.fn()})};});
vi.mock('@/hooks/useWishlist',()=>({useWishlist:()=>({toggle:vi.fn(),isWishlisted:()=>false,items:[],loading:false})}));
vi.mock('@/lib/firebase',()=>({db:{}}));
vi.mock('@/lib/firebase-auth',()=>({auth:{get currentUser(){return state.user;}}}));
vi.mock('firebase/firestore',()=>({
 doc:vi.fn(()=>({syntheticRef:true})),getDoc:vi.fn(async()=>({exists:()=>false})),setDoc:vi.fn(),
 onSnapshot:(ref:unknown,optionsOrNext:unknown,nextOrError:unknown,error?:unknown)=>{
  state.refs.push(ref);
  if(typeof optionsOrNext==='function'){
   state.ui=optionsOrNext as typeof state.ui;state.uiError=nextOrError as typeof state.uiError;return state.uiUnsub;
  }
  expect(optionsOrNext).toEqual({includeMetadataChanges:true});
  if(state.throwCompletion)throw new Error('Synthetic completion registration failure');
  state.completion=nextOrError as typeof state.completion;state.completionError=error as typeof state.completionError;return state.completionUnsub;
 }
}));
vi.mock('@/pages/PlanDetailPage/useAutoTranslate',async(original)=>{
 const actual=await original<typeof import('../../src/pages/PlanDetailPage/useAutoTranslate')>();
 return {...actual,useAutoTranslate:(...args:Parameters<typeof actual.useAutoTranslate>)=>{
  state.renderedTitle=String(args[0]?.itinerary?.tour_title||'');return actual.useAutoTranslate(...args);
 }};
});
import PlanDetailPage from '../../src/pages/PlanDetailPage';
import {beginAiPlanNotice,readAiPlanNotices} from '../../src/lib/aiPlanIssuanceNotice';
const planId='owner-read-plan';
const dataFor=(order:string)=>({uid:state.user.uid,planId,status:'ready',input:{paypalOrderId:order,language:'en'},itinerary:{days:[],tour_title:'Original English'},_streaming_in_progress:false});
const snap=(data:unknown,fromCache=false,hasPendingWrites=false)=>({exists:()=>true,data:()=>data,metadata:{fromCache,hasPendingWrites}});
const mount=()=>render(<MemoryRouter initialEntries={['/my-plans/'+planId]}><Routes><Route path="/my-plans/:planId" element={<PlanDetailPage/>}/></Routes></MemoryRouter>);
beforeEach(()=>{
 localStorage.clear();state.user={uid:'owner-read-user'};state.language='en';state.renderedTitle=null;
 state.ui=null;state.completion=null;state.uiError=null;state.completionError=null;state.refs=[];state.throwCompletion=false;
 state.uiUnsub.mockClear();state.completionUnsub.mockClear();
 Object.defineProperty(window,'matchMedia',{configurable:true,value:()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})});
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('External request forbidden');}));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('fresh metadata owner read settles unknown plan without cache/pending/stale-account release',async()=>{
 const uid=state.user.uid,order='OWNER-READ-ORDER';beginAiPlanNotice(uid,order,'attempt');mount();
 await waitFor(()=>expect(state.completion).toBeTypeOf('function'));expect(state.refs[0]).toBe(state.refs[1]);
 const data=dataFor(order);
 const deliver=async(fromCache:boolean,hasPendingWrites:boolean)=>act(async()=>state.completion?.(snap(data,fromCache,hasPendingWrites)));
 data.status='error';await deliver(false,false);expect(readAiPlanNotices(uid).notices).toHaveLength(1);data.status='ready';
 await deliver(true,false);expect(readAiPlanNotices(uid).notices).toHaveLength(1);
 await deliver(false,true);expect(readAiPlanNotices(uid).notices).toHaveLength(1);
 state.user={uid:'another-user'};await deliver(false,false);expect(readAiPlanNotices(uid).notices).toHaveLength(1);
 state.user={uid};await deliver(false,false);expect(readAiPlanNotices(uid).notices).toHaveLength(0);
 expect(fetch).not.toHaveBeenCalled();
});
it('actual page + real translation keep translated data on metadata settlement and translate real data changes',async()=>{
 const uid=state.user.uid,order='TRANSLATED-ORDER';beginAiPlanNotice(uid,order,'attempt');state.language='ko';
 const translate=vi.fn(async(url:unknown)=>{expect(url).toBe('/api/translate-plan');return new Response(JSON.stringify({data:{translated:{tour_title:'Translated '+translate.mock.calls.length,days:[]},translatorVersion:3}}));});
 vi.stubGlobal('fetch',translate);mount();await waitFor(()=>expect(state.ui).toBeTypeOf('function'));
 const data=dataFor(order);await act(async()=>state.ui?.(snap(data,true,false)));
 await waitFor(()=>expect(state.renderedTitle).toBe('Translated 1'));
 await act(async()=>state.completion?.(snap(data,false,false)));
 expect(state.renderedTitle).toBe('Translated 1');expect(readAiPlanNotices(uid).notices).toHaveLength(0);expect(translate).toHaveBeenCalledTimes(1);
 await act(async()=>state.ui?.(snap({...data,itinerary:{days:[],tour_title:'Changed English'}},false,false)));
 await waitFor(()=>expect(state.renderedTitle).toBe('Translated 2'));expect(translate).toHaveBeenCalledTimes(2);
});
it('both unsubscribed and late completion/UI callbacks are inert after unmount',async()=>{
 const uid=state.user.uid,order='LATE-ORDER';beginAiPlanNotice(uid,order,'attempt');const mounted=mount();
 await waitFor(()=>expect(state.completion).toBeTypeOf('function'));mounted.unmount();
 expect(state.uiUnsub).toHaveBeenCalledTimes(1);expect(state.completionUnsub).toHaveBeenCalledTimes(1);
 await act(async()=>{state.ui?.(snap(dataFor(order)));state.completion?.(snap(dataFor(order)));state.uiError?.({code:'permission-denied'});});
 expect(readAiPlanNotices(uid).notices).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();
});
it('completion permission failure has no fallback; UI permission failure invokes existing fallback exactly once',async()=>{
 const fallback=vi.fn(async()=>new Response(JSON.stringify({ok:false}),{status:403}));vi.stubGlobal('fetch',fallback);mount();
 await waitFor(()=>expect(state.completionError).toBeTypeOf('function'));
 await act(async()=>state.completionError?.({code:'permission-denied'}));expect(fallback).not.toHaveBeenCalled();
 await act(async()=>state.uiError?.({code:'permission-denied'}));expect(fallback).toHaveBeenCalledTimes(1);
});
it('completion registration throw leaves UI listener functional and cleaned up',async()=>{
 state.throwCompletion=true;const mounted=mount();await waitFor(()=>expect(state.ui).toBeTypeOf('function'));
 await act(async()=>state.ui?.(snap(dataFor('REGISTRATION-ORDER'))));expect(state.renderedTitle).toBe('Original English');
 mounted.unmount();expect(state.uiUnsub).toHaveBeenCalledTimes(1);expect(state.completionUnsub).not.toHaveBeenCalled();
});
