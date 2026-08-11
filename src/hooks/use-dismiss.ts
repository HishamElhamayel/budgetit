import { useRouter } from 'expo-router';
import { useCallback } from 'react';

/**
 * Close a modal without the risk of going nowhere.
 *
 * `router.back()` is a no-op when there's nothing on the stack to go back to,
 * which strands the user on a screen whose save button appears dead. That
 * happens whenever a modal is reached other than by navigation — a deep link,
 * a notification tap, or a refresh sitting on the route in development.
 */
export function useDismiss(): () => void {
  const router = useRouter();

  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
}
