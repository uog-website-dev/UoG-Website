"use client";
import {useEffect,useRef,useState} from 'react';
import {Box,Button,Typography} from '@mui/material';
import type {AnimationItem} from 'lottie-web';
import type {WidgetPropsMap} from '@uog/types';

/** Locally authored, expression-free vectors. No remote JSON, images or script assets. */
function animationData(code:string) {
 const colors:Record<string,number[]>={campus:[0.02,0.35,0.6,1],research:[0.05,0.48,0.52,1],community:[0.65,0.35,0.05,1]};
 return {v:'5.7.4',fr:30,ip:0,op:90,w:240,h:160,nm:'University connections',ddd:0,assets:[],layers:[0,1,2].map((index)=>({ddd:0,ind:index+1,ty:4,nm:'Connection',sr:1,ks:{o:{a:0,k:100},r:{a:0,k:0},p:{a:0,k:[60+index*60,80,0]},a:{a:0,k:[0,0,0]},s:{a:1,k:[{t:0,s:[65,65,100],e:[100,100,100],i:{x:[.6,.6,.6],y:[1,1,1]},o:{x:[.4,.4,.4],y:[0,0,0]}},{t:45,s:[100,100,100],e:[65,65,100],i:{x:[.6,.6,.6],y:[1,1,1]},o:{x:[.4,.4,.4],y:[0,0,0]}},{t:90,s:[65,65,100]}]}},ao:0,shapes:[{ty:'el',d:1,s:{a:0,k:[38,38]},p:{a:0,k:[0,0]},nm:'Circle'},{ty:'fl',c:{a:0,k:colors[code]??colors.campus},o:{a:0,k:100},r:1,nm:'Fill'}],ip:0,op:90,st:0,bm:0}))};
}
export function ApprovedAnimation({animation_code,loop}:WidgetPropsMap['lottie_player']) {
 const host=useRef<HTMLDivElement>(null),player=useRef<AnimationItem|null>(null);
 const [playing,setPlaying]=useState(false),[error,setError]=useState(false);
 const code=['campus','research','community'].includes(animation_code)?animation_code:'campus';
 useEffect(()=>{
  let active=true;setError(false);const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  import('lottie-web/build/player/lottie_light').then(({default:lottie})=>{if(!active||!host.current)return;const item=lottie.loadAnimation({container:host.current,renderer:'svg',loop,autoplay:!motion?.matches,animationData:animationData(code)});player.current=item;setPlaying(!motion?.matches);item.addEventListener('complete',()=>{if(active)setPlaying(false);});if(motion?.matches)item.goToAndStop(30,true);}).catch(()=>{if(active)setError(true);});
  const reduce=()=>{if(motion?.matches){player.current?.pause();setPlaying(false);}};motion?.addEventListener?.('change',reduce);
  return()=>{active=false;motion?.removeEventListener?.('change',reduce);player.current?.destroy();player.current=null;};
 },[code,loop]);
 return <Box sx={{display:'grid',justifyItems:'center',gap:1}}><Box ref={host} role="img" aria-label={`${code} connections animation`} sx={{width:'100%',maxWidth:360,aspectRatio:'3/2'}}/>{error?<Typography>Animation could not be loaded.</Typography>:<Button onClick={()=>{if(playing)player.current?.pause();else player.current?.play();setPlaying(!playing);}}>{playing?'Pause animation':'Play animation'}</Button>}</Box>;
}
