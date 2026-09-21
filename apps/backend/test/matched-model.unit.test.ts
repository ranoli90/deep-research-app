import {describe,expect,it} from "vitest";
import {matchedSearchDocument} from "./helpers/matched-model.js";

describe("matched search document control",()=>{
 it.each([
  ["offline editing vendor documentation","offline"],
  ["  OFFLINE\t\nediting independent review  ","offline"],
  ["Does PRODUCT support export and offline editing?","export"],
  ["OFFLINE editing EXPORT","export"],
 ] as const)("classifies bounded feature phrases in %j",(query,expected)=>{
  expect(matchedSearchDocument(query)).toBe(expected);
 });

 it.each([
  ["preoffline editing","export"],
  ["offline editingly","export"],
  ["offline editing exportable","offline"],
 ] as const)("does not classify substring lookalikes in %j",(query,expected)=>{
  expect(matchedSearchDocument(query)).toBe(expected);
 });
});
