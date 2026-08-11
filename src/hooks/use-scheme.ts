import type { Scheme } from '@/constants/palette';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Narrows React Native's nullable scheme to the two the palette defines. */
export function useScheme(): Scheme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}
