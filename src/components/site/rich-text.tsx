import Link from "next/link";
import { Fragment } from "react";
import { parseRichText } from "@/domains/site-content/richtext";
import { linkRel } from "@/domains/site-content/links";

/** Website words with checked `[words](/page)` links turned into real links. Nothing else in the text is interpreted. */
export function RichText({
  text,
  links = true,
  linkClassName = "underline hover:text-primary",
}: {
  text: string;
  links?: boolean;
  linkClassName?: string;
}) {
  return (
    <>
      {parseRichText(text, links).map((part, i) => {
        if (part.type === "text") return <Fragment key={i}>{part.text}</Fragment>;
        const t = part.target;
        if (t.type === "external") {
          return <a key={i} href={t.url} rel={linkRel(t)} className={linkClassName}>{part.label}</a>;
        }
        const href = t.type === "page" ? (t.anchor ? `${t.path}#${t.anchor}` : t.path) : "/";
        return <Link key={i} href={href} className={linkClassName}>{part.label}</Link>;
      })}
    </>
  );
}
