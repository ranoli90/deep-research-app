import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
const { alert }=vi.hoisted(()=>({alert:vi.fn()}));
vi.mock("react-native",()=>({Alert:{alert},Pressable:"Pressable",ScrollView:"ScrollView",Text:"Text",View:"View",Switch:"Switch"}));
import { ProfilePanel } from "../src/ProfilePanel";
function tree(node:ReactNode): {type:unknown;props:Record<string,any>}[]{
 if(Array.isArray(node))return node.flatMap(tree);
 if(!isValidElement<Record<string,any>>(node))return [];
 return [{type:node.type,props:node.props},...tree(node.props.children)];
}
function render(signedIn=false,consentGranted=false,routeMode:"fixture"|"controlled-research"="fixture",appearance:"system"|"light"|"dark"="system",processorDetailsOpen=true){
 const handlers={onDone:vi.fn(),onOpenLibrary:vi.fn(),onAppearance:vi.fn(),onConsent:vi.fn(),onSignIn:vi.fn(),onMode:vi.fn(),onRestore:vi.fn(),onDelete:vi.fn(),onLogout:vi.fn(),onRevoke:vi.fn(),onOpenDeletionPage:vi.fn(),onToggleProcessorDetails:vi.fn()};
 const nodes=tree(ProfilePanel({styles:{body:undefined,title:undefined,bodyText:undefined,link:undefined,caveat:undefined,error:undefined,kicker:undefined,card:undefined,row:undefined,avatar:undefined,avatarText:undefined,section:undefined,switchRow:undefined,segment:undefined,segmentOn:undefined,segmentOff:undefined},state:{signedIn,consentGranted,routeMode},accountLabel:"Account ab12cd34",appearance,processors:["Synthetic processor"],privacyFlows:"Synthetic data disclosure",deletionVsSub:"Cancel subscriptions separately",restoreMessage:"Store unavailable",processorDetailsOpen,...handlers}));
 const button=(label:string)=>{const node=nodes.find(n=>n.type==="Pressable"&&n.props.accessibilityLabel===label);expect(node).toBeTruthy();expect(node!.props.accessibilityRole).toBe("button");return node!;};
 const switchControl=(label:string)=>{const node=nodes.find(n=>n.type==="Switch"&&n.props.accessibilityLabel===label);expect(node).toBeTruthy();return node!;};
 const text=nodes.filter(n=>n.type==="Text").map(n=>JSON.stringify(n.props.children)).join(" ");
 return {handlers,nodes,button,switchControl,text};
}
beforeEach(()=>alert.mockReset());
it("W07 profile preserves accessible account, consent, restore and deletion-page callbacks",()=>{
 const x=render();
 for(const [label,key] of [["Sign in development session","onSignIn"],["Restore purchases","onRestore"],["Log out and clear saved drafts and reports","onLogout"],["Open web deletion page","onOpenDeletionPage"],["Open library","onOpenLibrary"]] as const){x.button(label).props.onPress();expect(x.handlers[key]).toHaveBeenCalledTimes(1);}
 x.switchControl("Grant AI processing consent").props.onValueChange(true);expect(x.handlers.onConsent).toHaveBeenCalledTimes(1);
 expect(x.text).toContain("Synthetic processor");expect(x.text).toContain("Synthetic data disclosure");expect(x.text).toContain("Cancel subscriptions separately");expect(x.text).toContain("Store unavailable");
 expect(x.text).toContain("Appearance");expect(x.text).toContain("Demo mode");expect(x.text).toContain("Sign out");expect(x.text).toContain("Saved reports");
});
it("W03 account deletion remains behind explicit destructive confirmation",()=>{
 const x=render(true,true);x.button("Delete account and derived data").props.onPress();expect(x.handlers.onDelete).not.toHaveBeenCalled();
 const [title,message,choices]=alert.mock.calls[0]!;expect(title).toBe("Delete account and research?");expect(message).toContain("cancels active runs");expect(message).toContain("subscriptions are managed separately");
 expect(choices.find((c:{style:string})=>c.style==="cancel").onPress).toBeUndefined();
 choices.find((c:{style:string})=>c.style==="destructive").onPress();expect(x.handlers.onDelete).toHaveBeenCalledTimes(1);
});
it("W07 mode labels are readable while callbacks retain the existing route identities",()=>{
 for(const route of ["fixture","controlled-research"] as const){
  const x=render(true,true,route);
  expect(x.text).toContain(route==="fixture"?"Demo":"Research");
  x.switchControl("Switch between demo and research mode").props.onValueChange(route!=="fixture");
  expect(x.handlers.onMode).toHaveBeenCalledWith(route==="fixture"?"controlled-research":"fixture");
  expect(x.switchControl("Revoke AI processing consent").props.value).toBe(true);
 }
});
it("W07 unavailable capabilities are explicit and account data cleanup remains disclosed",()=>{
 const x=render();expect(x.text).toContain("Push notifications are unavailable");expect(x.text).toContain("Reopen the app");expect(x.text).toContain("does not grant entitlement");expect(x.text).toContain("Signing out clears");expect(x.text).not.toContain("Notifications: optional");
});
it("W07 processor disclosures stay one tap behind How we process data",()=>{
 const closed=render(false,false,"fixture","system",false);
 expect(closed.text).toContain("How we process data");
 expect(closed.text).not.toContain("Synthetic processor");
 expect(closed.text).not.toContain("Synthetic data disclosure");
 closed.button("Show how we process data").props.onPress();
 expect(closed.handlers.onToggleProcessorDetails).toHaveBeenCalledTimes(1);
 const open=render(false,false,"fixture","system",true);
 expect(open.text).toContain("Hide how we process data");
 expect(open.text).toContain("Synthetic processor");
 expect(open.text).toContain("Synthetic data disclosure");
});
it("W07 appearance preference stays local and selectable",()=>{
 const x=render(true,false,"fixture","light");
 const dark=x.nodes.find(n=>n.type==="Pressable"&&n.props.accessibilityLabel==="Appearance Dark");
 expect(dark?.props.accessibilityRole).toBe("radio");
 dark!.props.onPress();
 expect(x.handlers.onAppearance).toHaveBeenCalledWith("dark");
 expect(x.text).toContain("Account ab12cd34");
});
