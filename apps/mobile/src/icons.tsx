import { View } from "react-native";

/** Original optical-weight line icons. Not Unicode stand-ins. Stroke ~1.5. */

function Stroke({
  color,
  width,
  height,
  radius = 1,
  style,
}: {
  color: string;
  width: number;
  height: number;
  radius?: number;
  style?: object;
}) {
  return <View style={[{ width, height, borderRadius: radius, backgroundColor: color }, style]} />;
}

export function PlusIcon({ color, size = 18 }: { color: string; size?: number }) {
  const arm = Math.max(10, size - 4);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Stroke color={color} width={arm} height={1.5} style={{ position: "absolute" }} />
      <Stroke color={color} width={1.5} height={arm} style={{ position: "absolute" }} />
    </View>
  );
}

export function ArrowUpIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Stroke color={color} width={1.5} height={size - 4} />
      <View
        style={{
          position: "absolute",
          top: 1,
          width: 7,
          height: 7,
          borderLeftWidth: 1.5,
          borderTopWidth: 1.5,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

export function StopIcon({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 2, backgroundColor: color }} />;
}

export function CloseIcon({ color, size = 14 }: { color: string; size?: number }) {
  const arm = size - 4;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Stroke color={color} width={arm} height={1.5} style={{ position: "absolute", transform: [{ rotate: "45deg" }] }} />
      <Stroke color={color} width={arm} height={1.5} style={{ position: "absolute", transform: [{ rotate: "-45deg" }] }} />
    </View>
  );
}

export function MenuIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: 12, justifyContent: "space-between" }}>
      <Stroke color={color} width={size} height={1.5} />
      <Stroke color={color} width={size * 0.62} height={1.5} />
    </View>
  );
}

export function BackIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderLeftWidth: 1.5,
          borderBottomWidth: 1.5,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

/** New research: rounded square with an inner plus. Not a rotated rectangle. */
export function PencilIcon({ color, size = 16 }: { color: string; size?: number }) {
  const inner = Math.max(8, size - 8);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <PlusIcon color={color} size={inner} />
      </View>
    </View>
  );
}

export function ChevronIcon({ color, size = 12, down = false }: { color: string; size?: number; down?: boolean }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 7,
          height: 7,
          borderRightWidth: 1.5,
          borderBottomWidth: 1.5,
          borderColor: color,
          transform: [{ rotate: down ? "45deg" : "-45deg" }],
        }}
      />
    </View>
  );
}

export function ShareIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}>
      <View
        style={{
          position: "absolute",
          top: 1,
          width: 6,
          height: 6,
          borderLeftWidth: 1.5,
          borderTopWidth: 1.5,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
      <Stroke color={color} width={1.5} height={size - 5} style={{ position: "absolute", top: 2 }} />
      <View
        style={{
          width: size - 4,
          height: size * 0.45,
          borderWidth: 1.5,
          borderTopWidth: 0,
          borderColor: color,
          borderBottomLeftRadius: 3,
          borderBottomRightRadius: 3,
        }}
      />
    </View>
  );
}
