import { PublicHomepage } from "../public-homepage";
import { publicHomepagePayload } from "../public-metadata";

export default async function HomePage() {
  const payload = await publicHomepagePayload();
  return <PublicHomepage initialPayload={payload} />;
}
