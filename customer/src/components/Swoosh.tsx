import { LinearGradient } from 'expo-linear-gradient';
import { swoosh } from '@/theme';

/** The Laboura colour stripe (`.sw`) under the header and above the tab bar. */
export function Swoosh({ height = 4 }: { height?: number }) {
  return (
    <LinearGradient
      colors={swoosh.colors}
      locations={swoosh.locations}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{ height }}
    />
  );
}
