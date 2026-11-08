/**
 * Compares receiverNameShown with the owner's name:
 * - Case and spacing ignored
 * - Both first and last name of the owner must appear in the receiver name
 */
export function matchReceiverName(
  ownerName: string,
  receiverNameShown: string,
): boolean {
  if (!ownerName || !receiverNameShown) {
    return false;
  }

  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normOwner = clean(ownerName);
  const normReceiver = clean(receiverNameShown);

  if (!normOwner || !normReceiver) {
    return false;
  }

  const ownerTokens = normOwner.split(' ').filter(Boolean);
  if (ownerTokens.length === 0) {
    return false;
  }

  const firstName = ownerTokens[0];
  const lastName = ownerTokens[ownerTokens.length - 1];

  const receiverTokens = normReceiver.split(' ').filter(Boolean);

  const hasFirst =
    receiverTokens.includes(firstName) || normReceiver.includes(firstName);
  const hasLast =
    receiverTokens.includes(lastName) || normReceiver.includes(lastName);

  return Boolean(hasFirst && hasLast);
}
