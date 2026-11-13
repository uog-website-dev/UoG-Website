import type {ComponentProps} from "react";
export function useRouter(){return {push:(href:string)=>{window.location.hash=href;}};}
export function usePathname(){return "/sites/11/admin/pages";}
export function useParams(){return {pageId:"00000000-0000-4000-8000-000000000001"};}
export function useServerInsertedHTML(){/* Client-only fixture has no server-inserted styles. */}
export default function Link({href,children,...props}:ComponentProps<"a">){return <a href={href} {...props}>{children}</a>;}
