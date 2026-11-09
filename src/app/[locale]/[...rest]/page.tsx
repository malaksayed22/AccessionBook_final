import { notFound } from "next/navigation";

/** Any URL under a language prefix that matches no page: render the localized not-found page. */
export default function CatchAll() {
  notFound();
}
