import { redirect } from "next/navigation";

export default async function TeamMemberRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/records/members/${id}`);
}
