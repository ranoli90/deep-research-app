import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
const { alert }=vi.hoisted(()=>({alert:vi.fn()}));
vi.mock("react-native",()=>({Alert:{alert},Pressable:"Pressable",ScrollView:"ScrollView",Text:"Text"}));
import { ProfilePanel } from "../src/ProfilePanel";
function tree(node:ReactNode): {type:unknown;props:Record<string,any>}[]{
 if(Array.isArray(node))return node.flatMap(tree);
 if(!isValidElement<Record<string,any>>(node))return [];
 return [{type:node.type,props:node.props},...tree(node.props.children)];
}
function render(signedIn=false,consentGranted=false,routeMode:"fixture"|"controlled-research"="fixture"){
 const handlers={onConsent:vi.fn(),onSignIn:vi.fn(),onMode:vi.fn(),onRestore:vi.fn(),onDelete:vi.fn(),onLogout:vi.fn(),onRevoke:vi.fn(),onOpenDeletionPage:vi.fn()};
 const nodes=tree(ProfilePanel({styles:{body:undefined,title:undefined,bodyText:undefined,link:undefined,caveat:undefined,error:undefined},state:{signedIn,consentGranted,routeMode},processors:["Synthetic processor"],privacyFlows:"Synthetic data disclosure",deletionVsSub:"Cancel subscriptions separately",restoreMessage:"Store unavailable",...handlers}));
 const button=(label:string)=>{const node=nodes.find(n=>n.type==="Pressable"&&n.props.accessibilityLabel===label);expect(node).toBeTruthy();expect(node!.props.accessibilityRole).toBe("button");return node!;};
 const text=nodes.filter(n=>n.type==="Text").map(n=>JSON.stringify(n.props.children)).join(" ");
 return {handlers,nodes,button,text};
}
beforeEach(()=>alert.mockReset());
it("W07 profile preserves accessible account, consent, restore and deletion-page callbacks",()=>{
 const x=render();
 for(const [label,key] of [["Sign in development session","onSignIn"],["Grant AI processing consent","onConsent"],["Restore purchases","onRestore"],["Revoke AI processing consent","onRevoke"],["Log out and clear saved drafts and reports","onLogout"],["Open web deletion page","onOpenDeletionPage"]] as const){x.button(label).props.onPress();expect(x.handlers[key]).toHaveBeenCalledTimes(1);}
 expect(x.text).toContain("Synthetic processor");expect(x.text).toContain("Synthetic data disclosure");expect(x.text).toContain("Cancel subscriptions separately");expect(x.text).toContain("Store unavailable");
});
it("W03 account deletion remains behind explicit destructive confirmation",()=>{
 const x=render(true,true);x.button("Delete account and derived data").props.onPress();expect(x.handlers.onDelete).not.toHaveBeenCalled();
 const [title,message,choices]=alert.mock.calls[0]!;expect(title).toBe("Delete account and research?");expect(message).toContain("cancels active runs");expect(message).toContain("subscriptions are managed separately");
 expect(choices.find((c:{style:string})=>c.style==="cancel").onPress).toBeUndefined();
 choices.find((c:{style:string})=>c.style==="destructive").onPress();expect(x.handlers.onDelete).toHaveBeenCalledTimes(1);
});
it("W07 mode labels are readable while callbacks retain the existing route identities",()=>{
 for(const route of ["fixture","controlled-research"] as const){const x=render(true,true,route);expect(x.text).toContain(route==="fixture"?"Demo":"Research");x.button("Switch between demo and research mode").props.onPress();expect(x.handlers.onMode).toHaveBeenCalledWith(route==="fixture"?"controlled-research":"fixture");expect(x.text).toContain("Consent granted");}
});
it("W07 unavailable capabilities are explicit and account data cleanup remains disclosed",()=>{
 const x=render();expect(x.text).toContain("Push notifications are unavailable");expect(x.text).toContain("Reopen the app");expect(x.text).toContain("does not grant entitlement");expect(x.text).toContain("Signing out clears");expect(x.text).not.toContain("Account, appearance");expect(x.text).not.toContain("Notifications: optional");
});
