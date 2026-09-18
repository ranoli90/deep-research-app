import { View } from "react-native";

/** Original optical-weight line icons. Not Unicode stand-ins. */
export function PlusIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: size - 6, height: 1.5, borderRadius: 1, backgroundColor: color }} />
      <View style={{ position: "absolute", width: 1.5, height: size - 6, borderRadius: 1, backgroundColor: color }} />
    </View>
  );
}

export function ArrowUpIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: 1.5, height: size - 4, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ position: "absolute", top: 1, width: 7, height: 7, borderLeftWidth: 1.5, borderTopWidth: 1.5, borderColor: color, transform: [{ rotate: "45deg" }] }} />
    </View>
  );
}

export function StopIcon({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 2, backgroundColor: color }} />;
}

export function CloseIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ position: "absolute", width: size - 4, height: 1.5, backgroundColor: color, transform: [{ rotate: "45deg" }] }} />
      <View style={{ position: "absolute", width: size - 4, height: 1.5, backgroundColor: color, transform: [{ rotate: "-45deg" }] }} />
    </View>
  );
}
