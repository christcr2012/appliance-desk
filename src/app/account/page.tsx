import { getServerSession } from "@/lib/session";

export default async function AccountHomePage() {
  const session = await getServerSession();

  return (
    <div>
      <h1 className="text-xl font-semibold">Welcome{session?.user?.name ? `, ${session.user.name}` : ""}</h1>
      <p className="mt-2 text-gray-600">
        Rentals, billing, and maintenance requests arrive in later phases.
      </p>
    </div>
  );
}
