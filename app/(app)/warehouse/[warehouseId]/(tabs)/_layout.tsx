// ============================================================================
// Kalta – (tabs) layout
// 5-tab root for the main app: Boxes / Items / Scan / Shopping / Settings.
// Shopping list is a permanent tab so the user can reach it without going
// through the notifications bell (the bell only surfaces when there are
// active alerts). Outer stack screens (box/[id], box/new, readiness, ...)
// are pushed over these tabs from the parent (app)/_layout Stack.
// ============================================================================
import { Tabs } from 'expo-router';
import { Icon } from '@/src/components/Icon';
import { colors } from '@/src/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Boxes',
          tabBarIcon: ({ color, size }) => (
            <Icon sf="shippingbox.fill" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="items"
        options={{
          title: 'Items',
          tabBarIcon: ({ color, size }) => (
            <Icon sf="list.bullet" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color, size }) => (
            <Icon sf="qrcode.viewfinder" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="shopping"
        options={{
          title: 'Shopping',
          tabBarIcon: ({ color, size }) => (
            <Icon sf="cart.fill" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Icon sf="gearshape.fill" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
