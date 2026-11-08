// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {PlannerWorkspaceRail} from '../../src/pages/PlannerPage/components/PlannerWorkspaceRail';
import {PlannerMasthead} from '../../src/pages/PlannerPage/components/PlannerMasthead';
import {PLANNER_COPY,type PlannerCopy} from '../../src/pages/PlannerPage/plannerCopy';
type Mode='ai'|'course';
type Props={copy:PlannerCopy;modes:ReadonlyArray<{key:Mode;title:string}>;selectedMode:Mode;showModes:boolean;onModeChange:(mode:Mode)=>void};
// Frozen markup from the former PlannerPage rail: extraction must preserve this DOM contract.
function OriginalRail({copy,modes,selectedMode,showModes,onModeChange}:Props){
 return <div className="planner-rail"><PlannerMasthead copy={copy}/>{showModes&&<section aria-labelledby="planner-mode-heading" className="planner-modes"><h2 id="planner-mode-heading" className="ec-eyebrow">{copy.modes.heading}</h2><div className="planner-mode-row">{modes.map(({key,title})=>{const active=selectedMode===key;return <button key={key} type="button" aria-pressed={active} aria-describedby={active?'planner-mode-desc':undefined} onClick={()=>onModeChange(key)} className={`planner-mode-btn ${active?'is-selected':''}`}>{title}</button>;})}</div></section>}</div>;
}
afterEach(cleanup);
describe('pure Planner workspace rail extraction',()=>{
 for(const lang of ['en','ko','ja','zh'] as const){
  const copy=PLANNER_COPY[lang];const modes:Props['modes']=[{key:'ai',title:copy.modes.guided.title},{key:'course',title:copy.modes.builder.title}];
  for(const selectedMode of ['ai','course'] as const)for(const showModes of [true,false]){
   it(`${lang}/${selectedMode}/visible=${showModes}: same DOM, classes, headings and ARIA`,()=>{
    const props={copy,modes,selectedMode,showModes,onModeChange:vi.fn()};
    const old=render(<OriginalRail {...props}/>);const expected=old.container.innerHTML;old.unmount();
    const actual=render(<PlannerWorkspaceRail {...props}/>);expect(actual.container.innerHTML).toBe(expected);
    expect(actual.container.querySelectorAll('.planner-mode-btn')).toHaveLength(showModes?2:0);
   });
  }
  it(`${lang}: selection remains parent-owned and calls the unchanged mode key`,()=>{
   const onModeChange=vi.fn();const props={copy,modes,selectedMode:'ai' as Mode,showModes:true,onModeChange};
   const {rerender}=render(<PlannerWorkspaceRail {...props}/>);
   const guided=screen.getByRole('button',{name:copy.modes.guided.title});const course=screen.getByRole('button',{name:copy.modes.builder.title});
   expect(guided).toHaveAttribute('aria-pressed','true');expect(guided).toHaveAttribute('aria-describedby','planner-mode-desc');
   fireEvent.click(course);expect(onModeChange).toHaveBeenCalledExactlyOnceWith('course');expect(guided).toHaveAttribute('aria-pressed','true');
   rerender(<PlannerWorkspaceRail {...props} selectedMode="course"/>);
   expect(course).toHaveAttribute('aria-pressed','true');expect(course).toHaveAttribute('aria-describedby','planner-mode-desc');expect(guided).not.toHaveAttribute('aria-describedby');
   rerender(<PlannerWorkspaceRail {...props} showModes={false}/>);expect(screen.queryByRole('button')).toBeNull();
  });
 }
});
