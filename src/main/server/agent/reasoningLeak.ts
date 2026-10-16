/**
 * Detects the model's English chain-of-thought surfacing in the visible reply of a
 * Chinese conversation ("The user requested a full consistency check." in the middle
 * of Chinese prose). Providers that stream reasoning inside content cause this; the
 * prompt discourages it but only code can notice when it still happens.
 */

const CJK = /[一-鿿]/g;
const LEAK_OPENERS =
  /(?:^|[。！？.!?\s])(?:The user (?:is |has |wants |asked|requested|said|wrote)|Let me |I need to |I should |I'll |I will |I'm going to |Now I |First, I |Okay, |Hmm)[^。！？\n]*[.。！？]/;

/** Share of CJK letters above which a text counts as Chinese. */
const CJK_RATIO = 0.3;

export function isMostlyCjk(text: string): boolean {
  const letters = text.replace(/[\s\d\p{P}]/gu, '');
  if (!letters) return false;
  return (letters.match(CJK)?.length ?? 0) / letters.length >= CJK_RATIO;
}

/** True when a Chinese reply (judged against the user's message) carries an English reasoning sentence. */
export function hasReasoningLeak(input: { userText: string; reply: string }): boolean {
  if (!isMostlyCjk(input.userText) || !isMostlyCjk(input.reply)) return false;
  return LEAK_OPENERS.test(input.reply);
}
