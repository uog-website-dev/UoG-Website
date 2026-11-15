import {MenuPreviewScreen} from "@/sites/menu-preview";
export const dynamic="force-dynamic";
export const metadata={title:"Private navigation preview",robots:{index:false,follow:false}};
export default async function MenuPreviewPage({searchParams}:{searchParams:Promise<{menu?:string|string[]}>}){
 const {menu}=await searchParams;
 return <MenuPreviewScreen menuId={typeof menu==='string'?menu:undefined}/>;
}
