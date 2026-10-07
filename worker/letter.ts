/** Private letter content; import this module only from the Worker. */
export const hundredDayLetterKey = 'letters/hundred-day.json';
export interface Letter { salutation: string; paragraphs: string[]; closing: string }

/** Validate cloud content without including any private text in errors. */
export function parseLetter(value: unknown): Letter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid letter');
  const letter = value as Record<string, unknown>;
  if (Object.keys(letter).length !== 3 || typeof letter.salutation !== 'string'
    || typeof letter.closing !== 'string' || !Array.isArray(letter.paragraphs)
    || letter.paragraphs.length === 0 || !letter.paragraphs.every(text => typeof text === 'string' && text.trim())) {
    throw new Error('Invalid letter');
  }
  return { salutation: letter.salutation, paragraphs: letter.paragraphs, closing: letter.closing };
}

// Keep the previously approved draft until the formal cloud letter is uploaded.
export const hundredDayLetter = {
  salutation: '何青青：',
  paragraphs: [
    '今天是我们在一起的第 100 天。这个日子，我想认真记下来。',
    '谢谢你陪我走到今天。以后的日子，也想和你继续慢慢往前走。平平淡淡，踏实过好每一天。',
  ],
  closing: '爱你，何青青。',
};
