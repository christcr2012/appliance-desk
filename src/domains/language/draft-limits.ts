export function translationDraftLimit(kind:string) {
 return kind==="LEGAL" || kind==="NOTICE" ? 20000 : 4000;
}
