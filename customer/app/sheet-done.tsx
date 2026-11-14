import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { routes } from '@/navigation/routes';
import { closeSecureSheet } from '@/sheet/openSheet';

/**
 * laboura://sheet-done — a link page sends the person back here when its
 * steps are finished (the `returnTo` the app adds to every sheet link).
 * Closes the sheet on iPhone and shows Home, which refreshes itself.
 */
export default function SheetDone() {
  useEffect(() => {
    void closeSecureSheet();
  }, []);
  return <Redirect href={routes.home} />;
}
