import { SetupPage } from "../../../../components/setups";
export default async function Page({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params;
  return <SetupPage handle={handle} slug={slug} />;
}
