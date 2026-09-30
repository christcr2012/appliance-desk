import Link from "next/link";
import { notFound } from "next/navigation";
import { getTasksForCustomer } from "@/domains/tasks";
import { LinkedTasksPanel } from "@/components/linked-tasks-panel";
import { getOperationalCustomerById } from "@/domains/customers/operational";

export async function OperationalCustomer({ id }: { id: string }) {
  const customer = await getOperationalCustomerById(id);
  if (!customer) notFound();
  const tasks = await getTasksForCustomer(id);
  return <div className="max-w-3xl">
    <Link href="/desk/customers" className="text-sm text-gray-600 hover:underline">← Back to customers</Link>
    <h1 className="mt-2 text-xl font-semibold">{customer.user.name ?? customer.user.email}</h1>
    <p className="mt-1 text-sm text-gray-600">{customer.user.email}{customer.phone ? ` · ${customer.phone}` : ""}{customer.companyName ? ` · ${customer.companyName}` : ""}</p>
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium">Service addresses</h2>
      {customer.serviceAddresses.length === 0 ? <p>No service addresses recorded.</p> : <ul className="mt-2 space-y-2">{customer.serviceAddresses.map(a => <li key={a.id}>{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city}, {a.state} {a.zip}</li>)}</ul>}
    </section>
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium">Jobs</h2>
      {customer.jobs.length === 0 ? <p>No jobs scheduled yet.</p> : <ul className="mt-2 space-y-2">{customer.jobs.map(j => <li key={j.id}><Link href={`/desk/jobs/${j.id}`} className="hover:underline">{j.type} — {j.status}{j.scheduledAt ? ` · ${j.scheduledAt.toLocaleDateString("en-US", { timeZone: "America/Denver" })}` : ""}</Link></li>)}</ul>}
    </section>
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium">Rental status</h2>
      {customer.rentalAgreements.length === 0 ? <p>No agreements yet.</p> : <ul className="mt-2 space-y-2">{customer.rentalAgreements.map(a => <li key={a.id}>{a.status}</li>)}</ul>}
    </section>
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium">Contacts</h2>
      {customer.contacts.length === 0 ? <p>No additional contacts recorded.</p> : <ul className="mt-2 space-y-2">{customer.contacts.map(c => <li key={c.id}>{c.name}{c.role ? ` (${c.role})` : ""}{c.phone ? ` · ${c.phone}` : ""}{c.email ? ` · ${c.email}` : ""}</li>)}</ul>}
    </section>
    <div className="mt-6"><LinkedTasksPanel linkType="customer" linkId={id} tasks={tasks} /></div>
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium">Notes</h2>
      {customer.notes.length === 0 ? <p>No notes recorded yet.</p> : <ul className="mt-2 space-y-3">{customer.notes.map(n => <li key={n.id}><p>{n.body}</p><p className="text-xs text-gray-500">{n.author?.name ?? "Staff"} · {n.createdAt.toLocaleDateString("en-US", { timeZone: "America/Denver" })}</p></li>)}</ul>}
    </section>
  </div>;
}
