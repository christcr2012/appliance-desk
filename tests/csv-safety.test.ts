import { expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
it.each([
  ["=1+1", "'=1+1"], ["+SUM(1;1)", "'+SUM(1;1)"], ["-1+2", "'-1+2"],
  ["@SUM(1;1)", "'@SUM(1;1)"], ["  =1+1", "'  =1+1"],
  ["\t=1+1", "'\t=1+1"], ["\r=1+1", "\"'\r=1+1\""],
  ["\n=1+1", "\"'\n=1+1\""], ["\uFEFF=1+1", "'\uFEFF=1+1"],
  ["+15551234567", "'+15551234567"],
])("exports text %j as a spreadsheet literal", (text, cell) => {
  expect(toCsv([{ key: "text", header: "Name" }], [{ text }])).toBe(`Name\r\n${cell}\r\n`);
});
it("preserves signed numeric accounting values and RFC quoting", () => {
  expect(toCsv([{ key: "name", header: "Name" }, { key: "amount", header: "Amount" }], [{ name: 'A, "B"\nC', amount: -1250 }, { name: "Normal", amount: 0 }])).toBe('Name,Amount\r\n"A, ""B""\nC",-1250\r\nNormal,0\r\n');
});
it("neutralizes headers and leaves null/undefined empty", () => {
  expect(toCsv([{ key: "a", header: "=1+1" }, { key: "b", header: "Plain" }], [{ a: null, b: undefined }])).toBe("'=1+1,Plain\r\n,\r\n");
});
