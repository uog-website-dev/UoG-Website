"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {Box,Button,Link,Typography} from '@mui/material';
import SchoolOutlined from '@mui/icons-material/SchoolOutlined';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined';
import MailOutline from '@mui/icons-material/MailOutline';
import PhoneOutlined from '@mui/icons-material/PhoneOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import type {WidgetPropsMap} from '@uog/types';

const icons={school:SchoolOutlined,book:MenuBookOutlined,calendar:CalendarMonthOutlined,location:LocationOnOutlined,mail:MailOutline,phone:PhoneOutlined,check:CheckCircleOutline,info:InfoOutlined};
export function ApprovedIcon({icon,label}:WidgetPropsMap['icon']) {const Icon=icons[icon];return <Box sx={{display:'inline-flex',gap:1.5,alignItems:'center'}}><Icon aria-hidden sx={{fontSize:32,color:'primary.main'}}/><Typography>{label}</Typography></Box>;}
export function Countdown({ends_at,label}:WidgetPropsMap['countdown']) {
 const [now,setNow]=useState<number|null>(null);
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[ends_at]);
 const end=Date.parse(ends_at),seconds=now===null?null:Math.max(0,Math.floor((end-now)/1000));
 if(!Number.isFinite(end))return <Typography role="status">Configure a valid event date.</Typography>;
 const parts=seconds===null?[]:[['Days',Math.floor(seconds/86400)],['Hours',Math.floor(seconds/3600)%24],['Minutes',Math.floor(seconds/60)%60],['Seconds',seconds%60]];
 return <Box role="timer" aria-label={label} aria-live="off" sx={{display:'grid',gap:2}}><Typography component="h3" variant="h6">{label}</Typography><Typography variant="body2"><time dateTime={ends_at}>{new Date(end).toLocaleString('en',{timeZone:'UTC'})} UTC</time></Typography>{seconds===0?<Typography>Event has started.</Typography>:<Box sx={{display:'flex',gap:2,flexWrap:'wrap'}}>{parts.map(([name,value])=><Box key={name} sx={{p:2,bgcolor:'action.hover',borderRadius:2,minWidth:76,textAlign:'center'}}><Typography sx={{fontSize:'2rem',fontWeight:800}}>{String(value).padStart(2,'0')}</Typography><Typography variant="caption">{name}</Typography></Box>)}</Box>}</Box>;
}
export function VideoPlayer({provider,video_id,title}:WidgetPropsMap['video_player']) {
 const [enabled,setEnabled]=useState(false);
 const href=provider==='youtube'?`https://www.youtube.com/watch?v=${video_id}`:`https://vimeo.com/${video_id}`;
 const src=provider==='youtube'?`https://www.youtube-nocookie.com/embed/${video_id}`:`https://player.vimeo.com/video/${video_id}?dnt=1`;
 return <Box sx={{display:'grid',gap:1}}><Typography component="h3" variant="h6">{title}</Typography>{enabled?<Box component="iframe" title={title} src={src} loading="lazy" referrerPolicy="no-referrer" allow="fullscreen; picture-in-picture" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation" sx={{width:'100%',aspectRatio:'16/9',border:0,borderRadius:2}}/>:<Box sx={{p:4,bgcolor:'action.hover',borderRadius:2,textAlign:'center'}}><Typography sx={{mb:2}}>Play this video using {provider==='youtube'?'YouTube':'Vimeo'}. Loading connects to the video provider.</Typography><Button variant="contained" onClick={()=>setEnabled(true)}>Load video</Button></Box>}<Link href={href} target="_blank" rel="noopener noreferrer">Open video in a new tab</Link></Box>;
}
export function LocationMap({latitude,longitude,zoom,title}:WidgetPropsMap['google_maps']) {
 const [enabled,setEnabled]=useState(false),href=`https://www.google.com/maps?q=${latitude},${longitude}&z=${zoom}`;
 return <Box sx={{display:'grid',gap:1}}><Typography component="h3" variant="h6">{title}</Typography>{enabled?<Box component="iframe" title={title} src={`${href}&output=embed`} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" sx={{width:'100%',height:360,border:0,borderRadius:2}}/>:<Box sx={{p:3,bgcolor:'action.hover',borderRadius:2}}><Typography sx={{mb:2}}>Load the map to connect to Google Maps.</Typography><Button variant="outlined" onClick={()=>setEnabled(true)}>Load map</Button></Box>}<Link href={href} target="_blank" rel="noopener noreferrer">Open location in a new tab</Link></Box>;
}
export function TableOfContents({title,max_level}:WidgetPropsMap['table_of_contents']) {
 const root=useRef<HTMLDivElement>(null),prefix=useId().replace(/[^a-zA-Z0-9]/g,'');
 const [links,setLinks]=useState<{id:string;text:string;level:number}[]>([]);
 useEffect(()=>{
  const article=root.current?.closest('article');if(!article)return;
  const update=()=>{const next=[...article.querySelectorAll<HTMLElement>('h2,h3,h4')].filter(h=>!h.closest('[data-widget-type="table_of_contents"]')&&Number(h.tagName[1])<=max_level).map((heading,index)=>{if(!heading.id){const owner=heading.closest('[data-item-id]')??heading.closest('[data-widget-type]');const stable=owner?.getAttribute('data-item-id')??owner?.getAttribute('data-node-id');const position=owner?[...owner.querySelectorAll('h2,h3,h4')].indexOf(heading):index;heading.id=stable?`section-${stable}-${position}`:`section-${prefix}-${index}`;}return {id:heading.id,text:heading.textContent??'',level:Number(heading.tagName[1])};});setLinks(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);};
  update();const observer=new MutationObserver(update);observer.observe(article,{childList:true,subtree:true,characterData:true});return()=>observer.disconnect();
 },[max_level,prefix]);
 return <Box ref={root} component="nav" aria-label={title} sx={{p:3,border:1,borderColor:'divider',borderRadius:2}}><Typography component="h2" variant="h6">{title}</Typography>{links.length?<Box component="ol" sx={{pl:2}}>{links.map(link=><Box component="li" key={link.id} sx={{ml:link.level-2}}><Link href={`#${link.id}`} onClick={()=>{const target=document.getElementById(link.id);if(target){target.tabIndex=-1;target.focus({preventScroll:true});}}} sx={{display:'inline-flex',alignItems:'center',minHeight:44}}>{link.text}</Link></Box>)}</Box>:<Typography>No sections to navigate yet.</Typography>}</Box>;
}
