import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createSessionStorage } from "./persist";
import { backendUrl } from "./api";
import { createProtectedContentStore } from "./protected-content";
import { createGuestDeviceStore } from "./auth/guest-device";

const options: SecureStore.SecureStoreOptions = {
  keychainService: "deep.research.session.v2",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Never fall back to AsyncStorage if the native credential store is unavailable. */
const contentOptions: SecureStore.SecureStoreOptions = {
  ...options, keychainService: "deep.research.content.v1",
};
const protectedCache = createProtectedContentStore(AsyncStorage, {
  getItem: key => SecureStore.getItemAsync(key, contentOptions),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, contentOptions),
  removeItem: key => SecureStore.deleteItemAsync(key, contentOptions),
});
export const sessionStorage = createSessionStorage(protectedCache, {
  getItem: (key) => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
  removeItem: (key) => SecureStore.deleteItemAsync(key, options),
}, backendUrl, 150);

const guestOptions: SecureStore.SecureStoreOptions = {
  keychainService: "norrow.guest.proof.v1",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const guestDevice = createGuestDeviceStore(protectedCache, {
  getItem: key => SecureStore.getItemAsync(key, guestOptions),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, guestOptions),
  removeItem: key => SecureStore.deleteItemAsync(key, guestOptions),
});
