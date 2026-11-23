"use client";
import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Box,Button,useMediaQuery} from '@mui/material';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';

export const containedImageHover={overflow:'hidden',borderRadius:2,'& img':{transition:'transform 240ms ease',transform:'scale(1)'},'@media (hover:hover) and (pointer:fine)':{'&:hover img':{transform:'scale(1.045)'}},'&:focus-within img':{transform:'scale(1.045)'},'@media (prefers-reduced-motion:reduce)':{'& img':{transition:'none',transform:'none'},'&:hover img,&:focus-within img':{transform:'none'}}};

export const newsCardHover={'@media (hover:hover) and (pointer:fine)':{'&:hover [data-image-hover="zoom"] img':{transform:'scale(1.045)'}},'@media (prefers-reduced-motion:reduce)':{'&:hover [data-image-hover="zoom"] img':{transform:'none'}}};

export function HorizontalCards({items,columns=3,label='Published content slider'}:{items:{id:string;content:ReactNode}[];columns?:number;label?:string}){
 const track=useRef<HTMLDivElement>(null);const [edges,setEdges]=useState({start:true,end:false});
 const reduced=useMediaQuery('(prefers-reduced-motion: reduce)');const count=Math.max(1,Math.min(4,columns));const identity=items.map(item=>item.id).join('|');
 const update=()=>{const el=track.current;if(el)setEdges({start:el.scrollLeft<=2,end:el.scrollLeft+el.clientWidth>=el.scrollWidth-2});};
 useEffect(()=>{const el=track.current;if(!el)return;el.scrollLeft=0;update();const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(update):null;observer?.observe(el);return()=>observer?.disconnect();},[identity,count]);
 const move=(direction:number)=>{const el=track.current;if(el)el.scrollBy({left:direction*el.clientWidth,behavior:reduced?'instant':'smooth'});};
 return <Box component="section" aria-label={label} sx={{minWidth:0}}>
  <Box sx={{display:'flex',justifyContent:'flex-end',gap:1,mb:2}}>
   <Button aria-label="Previous items" disabled={edges.start} onClick={()=>move(-1)} sx={{minWidth:44,minHeight:44}}><ArrowBackRounded/></Button>
   <Button aria-label="Next items" disabled={edges.end} onClick={()=>move(1)} sx={{minWidth:44,minHeight:44}}><ArrowForwardRounded/></Button>
  </Box>
  <Box ref={track} tabIndex={0} role="region" aria-label={`${label} cards`} onScroll={update}
   onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();move(event.key==='ArrowRight'?1:-1);}else if(event.key==='Home'||event.key==='End'){event.preventDefault();const el=track.current;el?.scrollTo({left:event.key==='Home'?0:el.scrollWidth,behavior:reduced?'instant':'smooth'});}}}
   sx={{display:'grid',gridAutoFlow:'column',gridAutoColumns:{xs:count===1?'100%':'85%',sm:`calc((100% - ${24*(Math.min(count,2)-1)}px) / ${Math.min(count,2)})`,lg:`calc((100% - ${24*(count-1)}px) / ${count})`},gap:3,overflowX:'auto',scrollSnapType:'x mandatory',scrollPaddingInline:1,pb:2,overscrollBehaviorX:'contain','&:focus-visible':{outline:'3px solid',outlineColor:'primary.main',outlineOffset:2}}}>
   {items.map(item=><Box key={item.id} sx={{scrollSnapAlign:'start',minWidth:0,height:'100%'}}>{item.content}</Box>)}
  </Box>
 </Box>;
}
