/**
 * Security AC-3: a public link (/p/...) is the person's own key to their page,
 * so a staff route that issues one answers without its token. The link reaches
 * the person by SMS; the customer app gets it only for the signed-in person.
 */
export function withoutLinkToken<T extends { token?: unknown }>(issued: T): Omit<T, 'token'> {
  const { token: _token, ...rest } = issued;
  void _token;
  return rest;
}
