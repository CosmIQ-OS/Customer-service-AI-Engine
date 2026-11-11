export interface DetectedLanguage {
  code: string;
  label: string;
  script: 'latin' | 'devanagari' | 'other';
}

const SCRIPT_RANGES: Array<{ code: string; label: string; pattern: RegExp }> = [
  { code: 'hi', label: 'Hindi', pattern: /[\u0900-\u097F]/ },
  { code: 'bn', label: 'Bengali', pattern: /[\u0980-\u09FF]/ },
  { code: 'pa', label: 'Punjabi', pattern: /[\u0A00-\u0A7F]/ },
  { code: 'gu', label: 'Gujarati', pattern: /[\u0A80-\u0AFF]/ },
  { code: 'ta', label: 'Tamil', pattern: /[\u0B80-\u0BFF]/ },
  { code: 'te', label: 'Telugu', pattern: /[\u0C00-\u0C7F]/ },
  { code: 'kn', label: 'Kannada', pattern: /[\u0C80-\u0CFF]/ },
  { code: 'ml', label: 'Malayalam', pattern: /[\u0D00-\u0D7F]/ },
  { code: 'ar', label: 'Arabic', pattern: /[\u0600-\u06FF]/ },
  { code: 'he', label: 'Hebrew', pattern: /[\u0590-\u05FF]/ },
  { code: 'ru', label: 'Russian', pattern: /[\u0400-\u04FF]/ },
  { code: 'el', label: 'Greek', pattern: /[\u0370-\u03FF]/ },
  { code: 'th', label: 'Thai', pattern: /[\u0E00-\u0E7F]/ },
  { code: 'ja', label: 'Japanese', pattern: /[\u3040-\u30FF]/ },
  { code: 'ko', label: 'Korean', pattern: /[\uAC00-\uD7AF]/ },
  { code: 'zh', label: 'Chinese', pattern: /[\u4E00-\u9FFF]/ },
];

const LATIN_HINTS: Array<{ code: string; label: string; words: string[] }> = [
  { code: 'es', label: 'Spanish', words: ['hola', 'gracias', 'quiero', 'necesito', 'servicio', 'precio', 'empresa', 'cómo', 'qué'] },
  { code: 'fr', label: 'French', words: ['bonjour', 'merci', 'besoin', 'service', 'prix', 'entreprise', 'vous', 'nous'] },
  { code: 'de', label: 'German', words: ['hallo', 'danke', 'brauche', 'dienst', 'preis', 'unternehmen', 'wir'] },
  { code: 'pt', label: 'Portuguese', words: ['olá', 'obrigado', 'preciso', 'serviço', 'preço', 'empresa', 'você'] },
  { code: 'it', label: 'Italian', words: ['ciao', 'grazie', 'bisogno', 'servizio', 'prezzo', 'azienda'] },
  { code: 'id', label: 'Indonesian', words: ['halo', 'terima', 'kasih', 'butuh', 'layanan', 'harga', 'perusahaan'] },
  { code: 'nl', label: 'Dutch', words: ['hallo', 'bedankt', 'nodig', 'dienst', 'prijs', 'bedrijf'] },
  { code: 'tr', label: 'Turkish', words: ['merhaba', 'teşekkür', 'istiyorum', 'hizmet', 'fiyat', 'şirket'] },
  { code: 'vi', label: 'Vietnamese', words: ['chào', 'cảm', 'ơn', 'dịch', 'vụ', 'giá', 'công', 'ty'] },
];

const ENGLISH_WORDS = [
  'the', 'a', 'an', 'and', 'is', 'are', 'was', 'we', 'our', 'my', 'me', 'you', 'your',
  'need', 'want', 'with', 'for', 'of', 'to', 'in', 'on', 'at', 'what', 'how', 'do',
  'does', 'can', 'could', 'would', 'should', 'company', 'team', 'tools', 'help',
  'please', 'thanks', 'thank', 'hello', 'hi', 'service', 'services', 'available',
];

const ENGLISH: DetectedLanguage = { code: 'en', label: 'English', script: 'latin' };

/** Best-effort language detection from script ranges, then common Latin stopwords. */
export function detectLanguage(text: string): DetectedLanguage {
  for (const entry of SCRIPT_RANGES) {
    if (entry.pattern.test(text)) {
      return {
        code: entry.code,
        label: entry.label,
        script: entry.code === 'hi' ? 'devanagari' : 'other',
      };
    }
  }

  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const set = new Set(words);
  const score = (dictionary: string[]) =>
    dictionary.reduce((total, word) => (set.has(word) ? total + 1 : total), 0);

  // English is the fallback, so another language must score strictly higher to win.
  let best = { code: ENGLISH.code, label: ENGLISH.label, score: score(ENGLISH_WORDS) };
  for (const entry of LATIN_HINTS) {
    const next = score(entry.words);
    if (next > best.score) best = { code: entry.code, label: entry.label, score: next };
  }
  return best.code === 'en' ? ENGLISH : { code: best.code, label: best.label, script: 'latin' };
}
