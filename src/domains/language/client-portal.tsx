"use client";
import { createContext, useContext } from "react";
import type { CustomerLanguage } from "./copy";
import { portalLabel, type PortalLabel } from "./portal-copy";

const LanguageContext = createContext<CustomerLanguage>("en");
export function CustomerLanguageProvider({ language, children }: {
  language: CustomerLanguage; children: React.ReactNode;
}) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}
export function useCustomerTranslation() {
  const language = useContext(LanguageContext);
  return (english: PortalLabel) => portalLabel(language, english);
}
