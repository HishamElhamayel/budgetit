/**
 * The account modal's own stack.
 *
 * Nested so that "Change email" and "Change password" push *inside* the sheet
 * rather than on top of it: they are steps within managing the account, and a
 * second presentation would leave the first one visible underneath with no way
 * to reach it. It also means each of the three screens gets a real header with
 * a real back button, which a single flat screen switching its own content
 * could only imitate.
 */

import { Stack } from 'expo-router';

export default function AccountLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Account' }} />
      <Stack.Screen name="email" options={{ title: 'Change email' }} />
      <Stack.Screen name="password" options={{ title: 'Change password' }} />
    </Stack>
  );
}
