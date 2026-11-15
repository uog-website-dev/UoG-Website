import {workspaceProxy} from "@/workspace-proxy";
export const GET = (request: Request) => workspaceProxy(request);
