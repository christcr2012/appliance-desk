import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { suggestedBooksStartDate } from "@/domains/books/management";
import { BooksSetupWizard } from "../setup-wizard";
import Link from "next/link";

export const metadata={title:"Set up your books"};
export default async function BooksSetupPage({searchParams}:{searchParams:Promise<{notice?:string}>}){
 const session=await requireRole("OWNER","ADMIN");
 const {notice}=await searchParams;
 const settings=await prisma.businessSettings.findUnique({where:{id:"singleton"},select:{booksStartDate:true}});
 const recommendedDate=await suggestedBooksStartDate();
 return <main className="mx-auto max-w-3xl space-y-5">
  <Link href="/desk/books" className="underline">Back to Your books</Link>
  <h1 className="text-2xl font-bold">Set up your books</h1>
  {notice&&<p role="alert" className="rounded border p-3">{notice.slice(0,300)}</p>}
  {session.user.role!=="OWNER"?<p>Ask the owner to set up the books. Only the owner can confirm when the business began and how much was in its accounts.</p>:
   settings?.booksStartDate?<p>Your books are already started. You can correct starting balances from the Books home page.</p>:
   <BooksSetupWizard recommendedDate={recommendedDate}/>}
 </main>;
}
