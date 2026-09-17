import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createSessionStorage } from "./persist";
import { backendUrl } from "./api";

const options: SecureStore.SecureStoreOptions = {
  keychainService: "deep.research.session.v2",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Never fall back to AsyncStorage if the native credential store is unavailable. */
export const sessionStorage = createSessionStorage(AsyncStorage, {
  getItem: (key) => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
  removeItem: (key) => SecureStore.deleteItemAsync(key, options),
}, backendUrl);
