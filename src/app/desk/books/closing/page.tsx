import { redirect } from "next/navigation";

// AR-7 (BOOKS-TAXES 1): the closing page's content (cash forecast, who pays on time, year-end)
// moved into Reports as the cash-and-customers view. The download route stays where it was.
export default function BooksClosingRedirect() {
  redirect("/desk/books/reports?view=cash-and-customers");
}
