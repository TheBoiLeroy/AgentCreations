import { ProfilePage } from "../../../components/setups";
export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  return <ProfilePage handle={(await params).handle} />;
}
