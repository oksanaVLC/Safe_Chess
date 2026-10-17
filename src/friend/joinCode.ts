// Join codes, as join_friend_game reads them: 8 characters from an
// alphabet without look-alikes (no 0, 1, I, L, O, U). Spaces and dashes
// are ignored and letters are upper-cased, exactly like the server does,
// so what the screen accepts is what the server accepts.

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const JOIN_CODE_LENGTH = 8;

/** The code as the server will read it: no spaces or dashes, upper case. */
export function normalizeJoinCode(text: string): string {
  return text.replace(/[\s-]/g, "").toUpperCase();
}

/** A complete code (already normalised). */
export function isJoinCode(code: string): boolean {
  return code.length === JOIN_CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

/** Can still become a code by typing more (already normalised)? */
export function isJoinCodeStart(code: string): boolean {
  return code.length <= JOIN_CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}
