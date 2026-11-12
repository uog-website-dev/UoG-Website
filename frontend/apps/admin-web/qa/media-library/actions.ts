export async function listSiteMedia(site:number,query:Record<string,unknown>) {
 const response = await fetch(`/fixture/sites/${site}/media?${new URLSearchParams(Object.entries(query).map(([k,v])=>[k,String(v)]))}`);
 return response.json();
}
export const getMediaUploadPolicy = async () => null;
export const getSiteMedia = async () => null;
export const updateSiteMedia = async () => null;
export const getMediaReferences = async () => null;
export const removeSiteMedia = async () => null;
