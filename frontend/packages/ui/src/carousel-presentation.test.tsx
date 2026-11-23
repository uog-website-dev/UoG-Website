import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ContentCarousel} from './visual-presentation';
const slides=[{id:'one',content:<p>First campus</p>,thumbnail:<span>First logo</span>},{id:'two',content:<p>Second campus</p>,thumbnail:<span>Second logo</span>}];
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it('supports logo thumbnail selection while retaining stable slide identity',()=>{
 render(<ContentCarousel items={slides} navigation="thumbnails"/>);
 expect(screen.getByText('First logo')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Go to slide 2'}));
 expect(screen.getByText('Second campus')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Go to slide 2'}).getAttribute('aria-current')).toBe('true');
});
it('bounds autoplay, pauses for focus and respects explicit pause',()=>{
 vi.useFakeTimers();render(<ContentCarousel items={slides} navigation="overlay" autoplaySeconds={5}/>);
 act(()=>vi.advanceTimersByTime(5000));expect(screen.getByText('Second campus')).toBeTruthy();
 const pause=screen.getByRole('button',{name:'Pause carousel'});fireEvent.focus(pause);
 act(()=>vi.advanceTimersByTime(10000));expect(screen.getByText('Second campus')).toBeTruthy();
 fireEvent.click(pause);act(()=>vi.advanceTimersByTime(10000));expect(screen.getByText('Second campus')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Play carousel'})).toBeTruthy();
});
it('disables automatic rotation for reduced motion',()=>{
 vi.spyOn(window,'matchMedia').mockImplementation(query=>({matches:query.includes('prefers-reduced-motion'),media:query,onchange:null,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:()=>true}));
 vi.useFakeTimers();render(<ContentCarousel items={slides} autoplaySeconds={5}/>);
 act(()=>vi.advanceTimersByTime(20000));expect(screen.getByText('First campus')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Pause carousel'})).toHaveProperty('disabled',true);
});


it('validates the full imported comparison tree on the frontend contract',async()=>{
 const {validateVisualLayout}=await import('@uog/types');
 const {default:layout}=await import('../../types/src/layout/aau-comparison.fixture.json');
 const checked=validateVisualLayout(layout);
 expect(checked).toMatchObject({ok:true});
});
