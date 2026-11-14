import { useFonts } from 'expo-font';
import { Sora_600SemiBold } from '@expo-google-fonts/sora/600SemiBold';
import { Sora_700Bold } from '@expo-google-fonts/sora/700Bold';
import { Sora_800ExtraBold } from '@expo-google-fonts/sora/800ExtraBold';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold';

/**
 * Loads Sora (headings, numbers) and IBM Plex Sans (everything else) from
 * files bundled with the app, so they work offline. Only the weights the
 * designs use are bundled.
 *
 * Returns true once the fonts are ready OR failed: a missing font must
 * never keep the app on a blank screen (the system font is used instead).
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
  });
  return loaded || error !== null;
}
