import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  it('defaults to English for unmarked Latin text', () => {
    assert.deepEqual(detectLanguage('Hello, what services do you offer?'), {
      code: 'en',
      label: 'English',
      script: 'latin',
    });
  });

  it('detects Latin languages from common words', () => {
    assert.equal(detectLanguage('Hola, necesito un servicio para mi empresa').code, 'es');
    assert.equal(detectLanguage('Bonjour, nous avons besoin de votre service').code, 'fr');
    assert.equal(detectLanguage('Hallo, ich brauche einen Dienst für mein Unternehmen').code, 'de');
  });

  it('detects languages by script', () => {
    assert.deepEqual(detectLanguage('नमस्ते, मुझे मदद चाहिए'), {
      code: 'hi',
      label: 'Hindi',
      script: 'devanagari',
    });
    assert.equal(detectLanguage('আমার কোম্পানি').code, 'bn');
    assert.equal(detectLanguage('こんにちは').code, 'ja');
    assert.equal(detectLanguage('مرحبا').code, 'ar');
  });

  it('prefers the script match when Latin words are absent', () => {
    const detected = detectLanguage('வணக்கம், உதவி தேவை');
    assert.equal(detected.code, 'ta');
    assert.equal(detected.script, 'other');
  });

  it('keeps English intake labels in English instead of matching shared words', () => {
    const detected = detectLanguage(
      'Company: Horizon Foods; Size: 60 employees; Tools: Excel and WhatsApp; Service: Workflow Automation',
    );
    assert.equal(detected.code, 'en');
  });
});
