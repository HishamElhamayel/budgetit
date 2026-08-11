import { Alert, Platform } from 'react-native';

/**
 * Confirm a destructive action on every platform.
 *
 * `Alert.alert` is a no-op in react-native-web, so any button gated behind it
 * silently does nothing in the browser — which is exactly how a delete button
 * comes to look broken during development. Falling back to `window.confirm`
 * keeps those paths testable on web without changing native behaviour.
 */
export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel = 'Delete'
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)
    );
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
