import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {HorizontalCards} from './horizontal-cards';
it('moves cards horizontally by buttons and keyboard without changing item links',()=>{
 render(<HorizontalCards label="News slider" items={[{id:'a',content:<a href="/posts/a">First article</a>},{id:'b',content:<a href="/posts/b">Second article</a>}]}/>);
 const region=screen.getByRole('region',{name:'News slider cards'});
 Object.defineProperty(region,'clientWidth',{value:300});Object.defineProperty(region,'scrollWidth',{value:900});
 const move=vi.fn();region.scrollBy=move;region.scrollTo=vi.fn();fireEvent.scroll(region);
 fireEvent.click(screen.getByRole('button',{name:'Next items'}));expect(move).toHaveBeenCalledWith(expect.objectContaining({left:300}));
 fireEvent.keyDown(region,{key:'ArrowRight'});expect(move).toHaveBeenCalledTimes(2);
 expect(screen.getByRole('link',{name:'First article'}).getAttribute('href')).toBe('/posts/a');
});
