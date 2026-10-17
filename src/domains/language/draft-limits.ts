export function translationDraftLimit(kind:string) {
 return kind==="LEGAL" || kind==="NOTICE" || kind==="QUOTE" ? 20000 : 4000;
}
