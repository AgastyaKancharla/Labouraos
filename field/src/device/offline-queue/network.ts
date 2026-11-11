import * as Network from 'expo-network';

/** Phone app: expo-network. Unknown reachability counts as online (the send decides). */
export function isOnline(state: Network.NetworkState): boolean {
  if (state.isConnected === false) return false;
  return state.isInternetReachable !== false;
}

export async function getOnline(): Promise<boolean> {
  try {
    return isOnline(await Network.getNetworkStateAsync());
  } catch {
    return true;
  }
}

export function subscribeOnline(listener: (online: boolean) => void): () => void {
  const sub = Network.addNetworkStateListener((state) => listener(isOnline(state)));
  return () => sub.remove();
}
